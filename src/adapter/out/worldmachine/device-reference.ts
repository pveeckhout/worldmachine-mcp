import type { DeviceSummary } from '../../../domain/device.js';
import { WorldMachineError } from '../../../domain/errors.js';

const ID_REFERENCE = /^#(\d+)$/;

/** The id in a `#<id>` reference, or undefined for anything else. */
export function idOfReference(reference: string): number | undefined {
  const match = ID_REFERENCE.exec(reference);
  return match ? Number(match[1]) : undefined;
}

/**
 * World Machine matches device names regardless of case (spec fact 31). `toLowerCase()` rather than
 * `toLocaleLowerCase()`: its result does not depend on the server's locale (a Turkish locale maps `I` to a dotless
 * `ı`), and fact 31 was observed on ASCII names only, so a locale-specific mapping would add nothing verified.
 */
const foldCase = (name: string): string => name.toLowerCase();

/**
 * Turns a device reference from a tool call into the reference commands use (spec section 9), given the devices of
 * a `device list` the caller already ran. `#<id>` passes through. A name that exactly one listed device has, in any
 * case, becomes `#<id>`. A name no listed device has is returned unchanged, so World Machine answers the command
 * that uses it with its own `Device not found`. A name several listed devices have, in any case, is refused: names
 * are not unique (spec fact 30). Edit use cases call this inside `exclusive()`, after their own `device list`.
 */
export function resolveDeviceReference(devices: readonly DeviceSummary[], reference: string): string {
  if (idOfReference(reference) !== undefined) return reference;
  const wanted = foldCase(reference);
  const matches = devices.filter((candidate) => foldCase(candidate.name) === wanted);
  if (matches.length > 1) {
    throw new WorldMachineError('REFUSED', `Device name '${reference}' is ambiguous; use #<id>`);
  }
  const match = matches[0];
  return match === undefined ? reference : `#${match.id}`;
}
