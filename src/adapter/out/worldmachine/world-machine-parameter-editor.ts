import type { ParameterEditPort } from '../../../application/port/out/parameter-edit-port.js';
import type { Parameter } from '../../../domain/device.js';
import { WorldMachineError, worldMachineText } from '../../../domain/errors.js';
import type { ParameterOutcome, ParameterUpdate, ParameterValue } from '../../../domain/graph-edit.js';
import { internalText, parseLength } from '../../../domain/lengths.js';
import { parameterInput } from '../../../domain/parameter-values.js';
import { buildCommand, type QuotedWord } from './command-builder.js';
import { lookUpDevice } from './device-lookup.js';
import { requireLine } from './edit-checks.js';
import { parseParamGet } from './parsers/param-get.js';
import { parseParamList } from './parsers/param-list.js';
import { type RawResponse, requireFrame, throwIfFailed } from './raw-response.js';
import type { WorldMachineSession } from './world-machine-session.js';

type PlannedSet = {
  readonly parameter: Parameter;
  /** `#<id>.<name>`: commands reference the device as `#<id>` (spec section 7, fact 18). */
  readonly reference: string;
  readonly text: string;
  readonly set: string;
  readonly get: string;
  /** Float-units design section 5: the length as given and the read at 1, for an item given with a unit. */
  readonly length?: { readonly given: string; readonly scale: string };
};

/** An item given as a length (float-units design section 3), planned once its scale is read. */
type LengthItem = {
  readonly parameter: Parameter;
  readonly reference: string;
  readonly word: string | QuotedWord;
  /** `param set <ref> 1`, the scale probe (design section 4, step 1). */
  readonly probe: string;
  readonly get: string;
  readonly given: string;
  readonly metres: number;
};

type Item = { readonly planned: PlannedSet } | { readonly length: LengthItem };
/** A length item becomes a planned set once its scale is read, or a rejected outcome (design section 4). */
type Resolved =
  | { readonly planned: PlannedSet }
  /** `probed`: the item's probe was applied and undone, which leaves a redo entry that sets it to 1. */
  | { readonly outcome: ParameterOutcome; readonly probed?: true };

// Spec fact 37: undo reverts one `param set` per call.
const UNDO_HINT =
  'Parameters set before this failure stay set; check them with get_device and revert with undo, one parameter per call.';
/** Float-units fact 87: display = internal x scale with no offset, so the read at 1 is the scale. */
const PROBE_VALUE = '1';
const UNDO = 'project undo';
/** raw/float-scale-undo.txt l.66-67 (fact 90). */
const UNDONE = 'Undo performed.';

export class WorldMachineParameterEditor implements ParameterEditPort {
  readonly #session: WorldMachineSession;

  constructor(session: WorldMachineSession) {
    this.#session = session;
  }

  async updateParameters(
    device: string,
    values: Readonly<Record<string, ParameterValue>>,
  ): Promise<ParameterUpdate> {
    const entries = Object.entries(values);
    if (entries.length === 0) throw new WorldMachineError('REFUSED', 'Give at least one parameter to set');
    const target = await lookUpDevice(this.#session, device);
    const ref = `#${target.id}`;
    const listed = await this.#session.executeOne(buildCommand(['param', 'list', ref]));
    throwIfFailed(listed);
    const parameters = parseParamList(listed.output);
    const items: Item[] = [];
    const problems: string[] = [];
    for (const [name, value] of entries) {
      // Exact match: World Machine's parameter names are case-sensitive (raw/p2c-edits.txt l.242-243, spec fact 35).
      const parameter = parameters.find((candidate) => candidate.name === name);
      if (parameter === undefined) {
        problems.push(`'${name}': no such parameter`);
        continue;
      }
      const input = parameterInput(parameter, value);
      if ('problem' in input) {
        problems.push(`'${name}': ${input.problem}`);
        continue;
      }
      const reference = `${ref}.${name}`;
      // raw/river-device.txt l.76-104: `param set` splits an unquoted reference at its first space and reads a
      // quoted one whole; `param get` reads the rest of the line and prints the reference without quotes.
      const word = /\s/.test(name) ? { quoted: reference } : reference;
      try {
        const get = buildCommand(['param', 'get'], reference);
        items.push(
          'length' in input
            ? {
                length: {
                  parameter,
                  reference,
                  word,
                  // Built here so a reference World Machine cannot take is refused before anything is sent.
                  probe: buildCommand(['param', 'set', word], PROBE_VALUE),
                  get,
                  ...input.length,
                },
              }
            : {
                planned: {
                  parameter,
                  reference,
                  text: input.text,
                  set: buildCommand(['param', 'set', word], input.text),
                  get,
                },
              },
        );
      } catch (error) {
        if (!(error instanceof WorldMachineError)) throw error;
        problems.push(`'${name}': ${error.message}`);
      }
    }
    if (problems.length > 0) {
      // v1 fact 10: a device without parameters lists none, so the refusal says so rather than ending in a colon.
      const known =
        parameters.length === 0
          ? 'It has no parameters'
          : `Its parameters: ${parameters.map((parameter) => `${parameter.name} (${parameter.type})`).join(', ')}`;
      throw new WorldMachineError(
        'REFUSED',
        `Nothing was set on ${ref} '${target.name}': ${problems.join('; ')}. ${known}`,
      );
    }
    // Float-units design section 4: the scale of each length item is read first, in call order. A restore that is
    // not confirmed throws here, before anything else is set.
    const resolved: Resolved[] = [];
    for (const item of items) {
      resolved.push(
        'planned' in item ? item : await this.#probeScale(`${ref} '${target.name}'`, item.length),
      );
    }
    const planned = resolved.flatMap((item) => ('planned' in item ? [item.planned] : []));
    // One batch, each `param set` followed by a `param get` of the same parameter (spec section 7). World Machine
    // runs the rest of a batch after a failing command (V2), so every item gets its outcome.
    const responses =
      planned.length === 0
        ? []
        : await this.#session.execute(planned.flatMap((item) => [item.set, item.get]));
    let next = 0;
    const results = resolved.map((item) => {
      if ('outcome' in item) return item;
      const frame = {
        item: item.planned,
        set: requireFrame(responses[next]),
        get: requireFrame(responses[next + 1]),
      };
      next += 2;
      return frame;
    });
    const applied = results.some((result) => 'set' in result && result.set.errors.length === 0);
    if (applied) this.#session.markDirty();
    try {
      const outcomes = results.map((result) =>
        'outcome' in result
          ? { outcome: result.outcome, probed: result.probed === true }
          : {
              outcome: outcomeOf(result.item, result.set, result.get),
              probed: result.item.length !== undefined,
            },
      );
      // Design section 4, last paragraph: with no `param set` confirmed, none sent or World Machine rejected every
      // one, nothing follows the probes' undo, so their redo entries stay. The console cannot clear one, so each
      // item probed and not set says so.
      return {
        device: { id: target.id, name: target.name },
        parameters: outcomes.map(({ outcome, probed }) =>
          applied || !probed ? outcome : withRedoNote(outcome),
        ),
      };
    } catch (error) {
      if (applied && error instanceof WorldMachineError) {
        throw new WorldMachineError(error.code, `${error.message} ${UNDO_HINT}`, error.worldMachineMessage);
      }
      throw error;
    }
  }

  /**
   * Float-units design section 4: reads the scale of a length item by setting it to 1, reading it, and undoing that
   * set, then plans the set of the converted value. Plan decision P1: the undo is sent only once the probe set was
   * accepted, in a batch of its own, since World Machine runs the rest of a batch after a failing command (V2). A
   * refused probe, or a read at 1 that is not a non-zero length, rejects this item only (plan decisions P2 and P3).
   */
  async #probeScale(device: string, item: LengthItem): Promise<Resolved> {
    const probe = requireFrame((await this.#session.execute([item.probe]))[0]);
    // Nothing was set, so this item's later steps, its undo among them, are skipped. A response with `Error:` counts
    // as refused even when it also echoes `Set <ref> = 1`: v1 design section 6 holds that a command World Machine
    // rejects with `Error:` changes nothing, and no capture shows both together.
    if (probe.errors.length > 0) {
      return { outcome: rejected(item, item.parameter.value, worldMachineText(probe.errors)) };
    }
    // Design section 4: the probe is an unsaved change even once undone, since undo may not restore the saved flag;
    // an unconfirmed probe may have changed the project too (ruling C2), so dirty is set before the check.
    this.#session.markDirty();
    requireProbeSet(device, item, probe);
    // A rejected batch (`execute` throws) means the World Machine process is gone: a TIMEOUT kills it, and a crash
    // surfaces as CRASHED or LOST_CHANGES after the markDirty above. Its error passes through unchanged; rewrapping it
    // as UNEXPECTED_OUTPUT would hide those codes.
    const responses = await this.#session.execute([item.get, UNDO, item.get]);
    const atOne = requireFrame(responses[0]);
    const restored = requireRestored(
      device,
      item,
      atOne,
      requireFrame(responses[1]),
      requireFrame(responses[2]),
    );
    const read = readingOf(atOne, item.reference);
    const metres = read === undefined ? undefined : parseLength(read);
    if (read !== undefined && metres !== undefined && metres !== 0) return lengthResolved(item, read, metres);
    const message =
      (read === undefined && atOne.errors.length > 0 ? worldMachineText(atOne.errors) : undefined) ??
      `could not read the scale of '${item.parameter.name}': it read '${read ?? shown(atOne)}' at 1`;
    return { outcome: rejected(item, restored, message), probed: true };
  }
}

/**
 * Design section 4: an accepted probe echoes `Set <ref> = 1` (raw/float-scale-undo-same.txt l.55), as a plain set
 * echoes its value. Neither refused nor confirmed, nothing shows whether the parameter changed, so no undo is sent (it
 * could revert an earlier step) and the call fails before anything else is sent.
 */
function requireProbeSet(device: string, item: LengthItem, probe: RawResponse): void {
  const echo = `Set ${item.reference} = ${PROBE_VALUE}`;
  if (probe.output.includes(echo)) return;
  throw new WorldMachineError(
    'UNEXPECTED_OUTPUT',
    `World Machine did not confirm the scale probe of '${item.parameter.name}' on ${device}: expected '${echo}'. ` +
      'The parameter may be left at 1; check it with get_device and revert with undo. Nothing else was set.',
    worldMachineText(probe.output),
  );
}

/**
 * Design section 4, steps 3 and 4: the undo printed its confirmation and the parameter reads its listed value again
 * (plan decision P6). Otherwise the call fails before anything else is set, in one of the two ways the design
 * separates, because they call for opposite advice. Returns the value read.
 */
function requireRestored(
  device: string,
  item: LengthItem,
  atOne: RawResponse,
  undo: RawResponse,
  after: RawResponse,
): string {
  const restored = readingOf(after, item.reference);
  const undone = undo.errors.length === 0 && undo.output.includes(UNDONE);
  if (undone && restored === item.parameter.value) return restored;
  const readings =
    `read at 1 '${readingOf(atOne, item.reference) ?? shown(atOne)}', expected '${item.parameter.value}', ` +
    `read after the undo '${restored ?? shown(after)}'`;
  const name = `'${item.parameter.name}' on ${device}`;
  if (!undone) {
    throw new WorldMachineError(
      'UNEXPECTED_OUTPUT',
      `World Machine did not confirm the undo of the scale probe of ${name} (no '${UNDONE}'): ${readings}. ` +
        'The undo was not confirmed and the parameter may be left at 1; check it with get_device and revert with ' +
        'undo. Nothing else was set.',
      worldMachineText([...undo.errors, ...undo.output]),
    );
  }
  throw new WorldMachineError(
    'UNEXPECTED_OUTPUT',
    `The undo of the scale probe of ${name} was confirmed, but the parameter does not read its listed value: ` +
      `${readings}. The undo may have reverted a step this call did not make; check the device with get_device ` +
      'before undoing anything. Nothing else was set.',
  );
}

/**
 * The set of a length item's internal value, converted with the scale it read at 1 (design section 4), or its
 * rejection when the value is out of range at that scale (plan decision P9). The probe was already undone and the
 * restore confirmed, so the listed value is the value now, and nothing more is sent for the item.
 */
function lengthResolved(item: LengthItem, scale: string, scaleMetres: number): Resolved {
  const text = internalText(item.metres, scaleMetres);
  if (text === undefined) {
    return {
      outcome: rejected(
        item,
        item.parameter.value,
        `the length is out of range at a scale of '${scale}'`,
        scale,
      ),
      probed: true,
    };
  }
  return {
    planned: {
      parameter: item.parameter,
      reference: item.reference,
      text,
      set: buildCommand(['param', 'set', item.word], text),
      get: item.get,
      length: { given: item.given, scale },
    },
  };
}

/** Design section 4, last paragraph: what the client must know when an applied, undone probe is the last edit. */
function withRedoNote(outcome: ParameterOutcome): ParameterOutcome {
  const note = `do not use redo before another edit, it would set '${outcome.name}' to 1`;
  return {
    ...outcome,
    worldMachineMessage:
      outcome.worldMachineMessage === undefined ? note : `${outcome.worldMachineMessage}; ${note}`,
  };
}

/**
 * Plan decisions P2 and P9: an item whose value was not set after its probe, whether the probe was refused or ran. `requested` is the text its probe
 * sent. `given` and `scale` come only with `scale`, an item whose scale was read (design section 5).
 */
function rejected(
  item: LengthItem,
  value: string,
  message: string | undefined,
  scale?: string,
): ParameterOutcome {
  return {
    name: item.parameter.name,
    type: item.parameter.type,
    requested: PROBE_VALUE,
    outcome: 'rejected',
    value,
    ...(message === undefined ? {} : { worldMachineMessage: message }),
    ...(scale === undefined ? {} : { given: item.given, scale }),
  };
}

/** The value `param get` printed, or undefined when it failed or printed no `<ref> = ` line. */
function readingOf(response: RawResponse, reference: string): string | undefined {
  if (response.errors.length > 0) return undefined;
  try {
    return parseParamGet(response.output, reference);
  } catch (error) {
    if (!(error instanceof WorldMachineError)) throw error;
    return undefined;
  }
}

/** A response's lines as a message may quote them: log and licence lines removed (spec section 8). */
function shown(response: RawResponse): string {
  return worldMachineText([...response.errors, ...response.output]) ?? '';
}

function outcomeOf(item: PlannedSet, set: RawResponse, get: RawResponse): ParameterOutcome {
  throwIfFailed(get);
  const value = parseParamGet(get.output, item.reference);
  const base = {
    name: item.parameter.name,
    type: item.parameter.type,
    requested: item.text,
    value,
    ...(item.length === undefined ? {} : item.length),
  };
  if (set.errors.length > 0) {
    // This text reaches the client in a success result, past `failure()`, so it gets the same filter (spec section 8).
    const message = worldMachineText(set.errors);
    return {
      ...base,
      outcome: 'rejected',
      ...(message === undefined ? {} : { worldMachineMessage: message }),
    };
  }
  // raw/v6b-param-set.txt l.84-85: `param set` echoes the reference and the value as given (spec fact 18).
  requireLine(set, `Set ${item.reference} = ${item.text}`, 'param set');
  return { ...base, outcome: 'applied' };
}
