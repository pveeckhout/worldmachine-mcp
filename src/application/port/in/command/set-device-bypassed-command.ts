import type { DeviceBypassState } from '../../../../domain/graph-edit.js';
import type { SessionSummary } from '../../../../domain/session.js';

export type SetDeviceBypassedCommand = { readonly device: string; readonly bypassed: boolean };
export type SetDeviceBypassedView = DeviceBypassState & { readonly session: SessionSummary };
export interface SetDeviceBypassedCommandPort {
  setDeviceBypassed(command: SetDeviceBypassedCommand): Promise<SetDeviceBypassedView>;
}
