import type { DeviceSummary } from '../../../../domain/device.js';
import type { SessionSummary } from '../../../../domain/session.js';

export type ListDevicesQuery = { readonly filter?: string };

export type DeviceListView = {
  readonly devices: readonly DeviceSummary[];
  readonly session: SessionSummary;
};

export interface ListDevicesQueryPort {
  listDevices(query: ListDevicesQuery): Promise<DeviceListView>;
}
