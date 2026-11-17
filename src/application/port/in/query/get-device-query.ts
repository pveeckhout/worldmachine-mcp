import type { CatalogInfo } from '../../../../domain/catalog.js';
import type { DeviceDetail } from '../../../../domain/device.js';
import type { SessionSummary } from '../../../../domain/session.js';

export type GetDeviceQuery = { readonly device: string };
export type DeviceView = {
  readonly device: DeviceDetail;
  readonly session: SessionSummary;
  readonly catalog: CatalogInfo;
};
export interface GetDeviceQueryPort {
  getDevice(query: GetDeviceQuery): Promise<DeviceView>;
}
