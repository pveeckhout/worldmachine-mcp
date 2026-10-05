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

/**
 * The listed device a reference names, for edit commands. Those always address a device as `#<id>`:
 * `buildCommand` never emits quotes, so a name could only be sent as a final argument. A reference no listed device
 * matches has no id to send and is refused before anything is sent (Plan 2c decision D3).
 */
export function findListedDevice(devices: readonly DeviceSummary[], reference: string): DeviceSummary {
  const id = idOfReference(resolveDeviceReference(devices, reference));
  const device = devices.find((candidate) => candidate.id === id);
  if (device === undefined) {
    throw new WorldMachineError(
      'REFUSED',
      `No device '${reference}' in the current project; see list_devices`,
    );
  }
  return device;
}

// Name endings that parsers/device-list.ts reads as a state marker or a kind (spec facts 24 and 29).
const MARKER_SUFFIX = /\s\[(?:disabled|bypassed)\]$/;
const KIND_SUFFIX = /\s{2,}\([^()]+\)$/;
const ID_LIKE = /^#\d+$/;
/** `device list` shows at most the first 23 characters of a name (spec fact 33, raw/p2c-edits.txt l.50-69). */
export const LISTED_NAME_LIMIT = 23;

/**
 * Refuses a new device name that `device list` could not show so that it reads back as the same name
 * (backlog, Plan 2c gate; Plan 2c decision D5).
 */
export function assertReadableDeviceName(name: string): void {
  const rule =
    name !== name.trim()
      ? 'start or end with whitespace'
      : MARKER_SUFFIX.test(name)
        ? 'end with [disabled] or [bypassed]'
        : KIND_SUFFIX.test(name)
          ? 'end with two spaces and parenthesised text'
          : ID_LIKE.test(name)
            ? 'look like a device id (#<n>)'
            : name.length > LISTED_NAME_LIMIT
              ? `be longer than ${LISTED_NAME_LIMIT} characters`
              : undefined;
  if (rule !== undefined) {
    throw new WorldMachineError(
      'REFUSED',
      `Device name '${name}' must not ${rule}: device list could not show it unambiguously`,
    );
  }
}
