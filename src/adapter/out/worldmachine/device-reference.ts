import type { DeviceSummary } from '../../../domain/device.js';
import { deviceNameProblem, foldCase, idOfReference } from '../../../domain/device-name.js';
import { WorldMachineError } from '../../../domain/errors.js';

export {
  foldCase,
  idOfReference,
  LISTED_NAME_LIMIT,
  matchesListedName,
} from '../../../domain/device-name.js';

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

/**
 * Refuses a new device name that `device list` could not show so that it reads back as the same name
 * (backlog, Plan 2c gate; Plan 2c decision D5).
 */
export function assertReadableDeviceName(name: string): void {
  const rule = deviceNameProblem(name);
  if (rule !== undefined) {
    throw new WorldMachineError(
      'REFUSED',
      `Device name '${name}' must not ${rule}: device list could not show it unambiguously`,
    );
  }
}
