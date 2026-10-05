import type { DeviceSummary } from '../../../../domain/device.js';
import type { SessionSummary } from '../../../../domain/session.js';

export type AddDeviceCommand = { readonly type: string; readonly name?: string };
export type AddDeviceView = { readonly device: DeviceSummary; readonly session: SessionSummary };
export interface AddDeviceCommandPort {
  addDevice(command: AddDeviceCommand): Promise<AddDeviceView>;
}
