import type {
  OrganizeDevicesCommand,
  OrganizeDevicesCommandPort,
  OrganizeDevicesView,
} from '../port/in/command/organize-devices-command.js';
import type { DeviceEditPort } from '../port/out/device-edit-port.js';
import type { WorldMachineSessionPort } from '../port/out/world-machine-session-port.js';

export class OrganizeDevicesService implements OrganizeDevicesCommandPort {
  readonly #session: WorldMachineSessionPort;
  readonly #devices: DeviceEditPort;

  constructor(session: WorldMachineSessionPort, devices: DeviceEditPort) {
    this.#session = session;
    this.#devices = devices;
  }

  organizeDevices(_command: OrganizeDevicesCommand): Promise<OrganizeDevicesView> {
    return this.#session.exclusive(async () => {
      await this.#devices.organize();
      return { session: this.#session.status().session };
    });
  }
}
