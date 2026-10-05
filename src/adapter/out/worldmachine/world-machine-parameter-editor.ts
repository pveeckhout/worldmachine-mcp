import type { ParameterEditPort } from '../../../application/port/out/parameter-edit-port.js';
import type { Parameter } from '../../../domain/device.js';
import { WorldMachineError, worldMachineText } from '../../../domain/errors.js';
import type { ParameterOutcome, ParameterUpdate, ParameterValue } from '../../../domain/graph-edit.js';
import { buildCommand } from './command-builder.js';
import { lookUpDevice } from './device-lookup.js';
import { requireLine } from './edit-checks.js';
import { parameterText } from './parameter-values.js';
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
};

// Spec fact 37: undo reverts one `param set` per call.
const UNDO_HINT =
  'Parameters set before this failure stay set; check them with get_device and revert with undo, one parameter per call.';

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
    const planned: PlannedSet[] = [];
    const problems: string[] = [];
    for (const [name, value] of entries) {
      // Exact match: World Machine's parameter names are case-sensitive (raw/p2c-edits.txt l.242-243, spec fact 35).
      const parameter = parameters.find((candidate) => candidate.name === name);
      if (parameter === undefined) {
        problems.push(`'${name}': no such parameter`);
        continue;
      }
      const text = parameterText(parameter, value);
      if ('problem' in text) {
        problems.push(`'${name}': ${text.problem}`);
        continue;
      }
      const reference = `${ref}.${name}`;
      try {
        planned.push({
          parameter,
          reference,
          text: text.text,
          set: buildCommand(['param', 'set', reference], text.text),
          get: buildCommand(['param', 'get', reference]),
        });
      } catch (error) {
        if (!(error instanceof WorldMachineError)) throw error;
        problems.push(`'${name}': ${error.message}`);
      }
    }
    if (problems.length > 0) {
      const known = parameters.map((parameter) => `${parameter.name} (${parameter.type})`).join(', ');
      throw new WorldMachineError(
        'REFUSED',
        `Nothing was set on ${ref} '${target.name}': ${problems.join('; ')}. Its parameters: ${known}`,
      );
    }
    // One batch, each `param set` followed by a `param get` of the same parameter (spec section 7). World Machine
    // runs the rest of a batch after a failing command (V2), so every item gets its outcome.
    const responses = await this.#session.execute(planned.flatMap((item) => [item.set, item.get]));
    const frames = planned.map((item, index) => ({
      item,
      set: requireFrame(responses[2 * index]),
      get: requireFrame(responses[2 * index + 1]),
    }));
    const applied = frames.some(({ set }) => set.errors.length === 0);
    if (applied) this.#session.markDirty();
    try {
      return {
        device: { id: target.id, name: target.name },
        parameters: frames.map(({ item, set, get }) => outcomeOf(item, set, get)),
      };
    } catch (error) {
      if (applied && error instanceof WorldMachineError) {
        throw new WorldMachineError(error.code, `${error.message} ${UNDO_HINT}`, error.worldMachineMessage);
      }
      throw error;
    }
  }
}

function outcomeOf(item: PlannedSet, set: RawResponse, get: RawResponse): ParameterOutcome {
  throwIfFailed(get);
  const value = parseParamGet(get.output, item.reference);
  const base = { name: item.parameter.name, type: item.parameter.type, requested: item.text, value };
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
