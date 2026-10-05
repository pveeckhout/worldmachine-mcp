import type { DeviceEnabledState } from '../../../../domain/graph-edit.js';
import type { SessionSummary } from '../../../../domain/session.js';

export type SetDeviceEnabledCommand = { readonly device: string; readonly enabled: boolean };
export type SetDeviceEnabledView = DeviceEnabledState & { readonly session: SessionSummary };
export interface SetDeviceEnabledCommandPort {
  setDeviceEnabled(command: SetDeviceEnabledCommand): Promise<SetDeviceEnabledView>;
}
