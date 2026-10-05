import type { DeviceSummary } from '../../../domain/device.js';
import { findListedDevice } from './device-reference.js';
import { parseDeviceList } from './parsers/device-list.js';
import { throwIfFailed } from './raw-response.js';
import type { WorldMachineSession } from './world-machine-session.js';

/** The project's devices from one unfiltered `device list`. Edit adapters run it first and resolve against it. */
export async function listAllDevices(session: WorldMachineSession): Promise<DeviceSummary[]> {
  const response = await session.executeOne('device list');
  throwIfFailed(response);
  return parseDeviceList(response.output);
}

/**
 * The listed device `reference` names, after the edit's own `device list` (ruling C1). Callers run inside
 * `exclusive()`, so no other command use case changes the list before the edit command is sent.
 */
export async function lookUpDevice(session: WorldMachineSession, reference: string): Promise<DeviceSummary> {
  return findListedDevice(await listAllDevices(session), reference);
}
