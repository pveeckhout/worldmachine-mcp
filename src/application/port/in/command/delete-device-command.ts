import type { DeviceSummary } from '../../../../domain/device.js';
import type { SessionSummary } from '../../../../domain/session.js';

export type DeleteDeviceCommand = { readonly device: string };
export type DeleteDeviceView = { readonly deleted: DeviceSummary; readonly session: SessionSummary };
export interface DeleteDeviceCommandPort {
  deleteDevice(command: DeleteDeviceCommand): Promise<DeleteDeviceView>;
}
