import type { DeviceSummary } from '../../../domain/device.js';

export interface ProjectGraphReadPort {
  listDevices(filter?: string): Promise<DeviceSummary[]>;
}
