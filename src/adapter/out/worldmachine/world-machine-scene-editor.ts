import type { SceneEditPort } from '../../../application/port/out/scene-edit-port.js';
import { WorldMachineError } from '../../../domain/errors.js';
import type { SceneChanges } from '../../../domain/graph-edit.js';
import type { Scene } from '../../../domain/scene.js';
import { buildCommand } from './command-builder.js';
import { requireLine, requireMatch } from './edit-checks.js';
import { decimalText } from './parameter-values.js';
import { parseSceneShow } from './parsers/scene.js';
import { unexpectedOutput } from './parsers/unexpected.js';
import { type RawResponse, requireFrame, throwIfFailed } from './raw-response.js';
import type { WorldMachineSession } from './world-machine-session.js';

// Confirmations as captured in raw/p2b-graph-edits.txt l.191-192, 197-198, 207-208 (spec fact 27). World Machine
// prints coordinates and sizes with two decimals; the patterns do not compare values, because no capture shows how
// it rounds a third decimal.
const RENAMED = /^Renamed scene from '.*' to '(.*)'$/;
const ORIGIN_SET = /^Set scene origin to \(-?\d+\.\d{2}, -?\d+\.\d{2}\) km$/;
const SIZE_SET = /^Set scene size to \d+\.\d{2} x \d+\.\d{2} km$/;

type Setter = {
  readonly label: string;
  readonly command: string;
  readonly confirm: (response: RawResponse) => void;
};

function decimal(value: number, what: string): string {
  const text = decimalText(value);
  if (text === undefined) {
    throw new WorldMachineError('REFUSED', `${what} must be a plain decimal number, not ${value}`);
  }
  return text;
}

function positive(value: number, what: string): string {
  // raw/p2b-graph-edits.txt l.210-211: World Machine rejects a zero size.
  if (!(value > 0)) throw new WorldMachineError('REFUSED', `${what} must be positive, not ${value}`);
  return decimal(value, what);
}

/** The setters for `changes`, checked and built before anything is sent, in a fixed order. */
function sceneSetters(changes: SceneChanges): Setter[] {
  const setters: Setter[] = [];
  const { name, originKm, sizeKm, resolution } = changes;
  if (name !== undefined) {
    setters.push({
      label: 'name',
      command: buildCommand(['scene', 'name'], name),
      confirm: (response) => {
        if (requireMatch(response, RENAMED, 'scene name')[1] !== name) {
          throw unexpectedOutput('scene name', response.output);
        }
      },
    });
  }
  if (originKm !== undefined) {
    setters.push({
      label: 'origin',
      command: buildCommand([
        'scene',
        'origin',
        decimal(originKm.x, 'origin x'),
        decimal(originKm.y, 'origin y'),
      ]),
      confirm: (response) => void requireMatch(response, ORIGIN_SET, 'scene origin'),
    });
  }
  if (sizeKm !== undefined) {
    setters.push({
      label: 'size',
      command: buildCommand([
        'scene',
        'size',
        positive(sizeKm.width, 'width'),
        positive(sizeKm.height, 'height'),
      ]),
      confirm: (response) => void requireMatch(response, SIZE_SET, 'scene size'),
    });
  }
  if (resolution !== undefined) {
    // Spec section 7: a positive integer; World Machine's `up`/`down` steps are not exposed.
    // World Machine has no bound of its own: it accepted 7 and 100000 (raw/p2c-edits.txt l.317-321, spec fact 38).
    if (!(Number.isSafeInteger(resolution) && resolution > 0)) {
      throw new WorldMachineError(
        'REFUSED',
        `The resolution must be a positive whole number, not ${resolution}`,
      );
    }
    setters.push({
      label: 'resolution',
      command: buildCommand(['scene', 'resolution', String(resolution)]),
      // raw/p2b-graph-edits.txt l.219-220.
      confirm: (response) =>
        requireLine(response, `Set scene resolution to ${resolution}`, 'scene resolution'),
    });
  }
  return setters;
}

export class WorldMachineSceneEditor implements SceneEditPort {
  readonly #session: WorldMachineSession;

  constructor(session: WorldMachineSession) {
    this.#session = session;
  }

  async configureScene(changes: SceneChanges): Promise<Scene> {
    const setters = sceneSetters(changes);
    if (setters.length === 0) {
      throw new WorldMachineError('REFUSED', 'Give at least one of name, origin, size, or resolution');
    }
    // One batch; World Machine runs the rest of a batch after a failing command (V2), so every setter gets an answer.
    const responses = await this.#session.execute([...setters.map((setter) => setter.command), 'scene show']);
    const frames = setters.map((setter, index) => ({ setter, response: requireFrame(responses[index]) }));
    const show = requireFrame(responses[setters.length]);
    // Accepted: no `Error:` line. World Machine may have acted on those whatever it printed (ruling C2).
    const accepted = frames.filter(({ response }) => response.errors.length === 0);
    if (accepted.length > 0) this.#session.markDirty();
    // Applied: accepted and confirmed by its line (ruling K2). Accepted without the line is UNEXPECTED_OUTPUT.
    const applied: string[] = [];
    const unconfirmed: { readonly label: string; readonly error: WorldMachineError }[] = [];
    for (const { setter, response } of accepted) {
      try {
        setter.confirm(response);
        applied.push(setter.label);
      } catch (error) {
        if (!(error instanceof WorldMachineError)) throw error;
        unconfirmed.push({ label: setter.label, error });
      }
    }
    // Spec fact 28: undo reverts one scene setter per call.
    const appliedNote =
      applied.length === 0 ? '' : `; it applied ${applied.join(', ')}, and undo reverts one setting per call`;
    const unconfirmedNote =
      unconfirmed.length === 0
        ? ''
        : `; it accepted ${unconfirmed.map(({ label }) => label).join(', ')} without the confirmation line, so the effect is unknown`;
    const rejected = frames.filter(({ response }) => response.errors.length > 0);
    const first = rejected[0];
    if (first !== undefined) {
      throw new WorldMachineError(
        'WM_COMMAND_FAILED',
        `World Machine rejected "${first.response.command}"${appliedNote}${unconfirmedNote}`,
        // A locked scene answers every setter with the same line (spec fact 38); each distinct line is kept once.
        [...new Set(rejected.flatMap(({ response }) => response.errors))].join('\n'),
      );
    }
    const missing = unconfirmed[0];
    if (missing !== undefined) {
      throw new WorldMachineError(
        'UNEXPECTED_OUTPUT',
        applied.length === 0
          ? missing.error.message
          : `${missing.error.message} World Machine applied ${applied.join(', ')}, and undo reverts one setting per call.`,
        missing.error.worldMachineMessage,
      );
    }
    throwIfFailed(show);
    return parseSceneShow(show.output);
  }
}
