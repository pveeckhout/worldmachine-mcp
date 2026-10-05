import type { DeviceDetail, DeviceSummary } from '../../../domain/device.js';
import type { ProjectOverview } from '../../../domain/project.js';
import type { Scene } from '../../../domain/scene.js';

export interface ProjectGraphReadPort {
  listDevices(filter?: string): Promise<DeviceSummary[]>;
  /** `device` is a device name or `#<id>`. */
  getDevice(device: string): Promise<DeviceDetail>;
  getScene(): Promise<Scene>;
  inspectProject(): Promise<ProjectOverview>;
}
