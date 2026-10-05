import type {
  RenameDeviceCommand,
  RenameDeviceCommandPort,
  RenameDeviceView,
} from '../port/in/command/rename-device-command.js';
import type { DeviceEditPort } from '../port/out/device-edit-port.js';
import type { WorldMachineSessionPort } from '../port/out/world-machine-session-port.js';

export class RenameDeviceService implements RenameDeviceCommandPort {
  readonly #session: WorldMachineSessionPort;
  readonly #devices: DeviceEditPort;

  constructor(session: WorldMachineSessionPort, devices: DeviceEditPort) {
    this.#session = session;
    this.#devices = devices;
  }

  renameDevice(command: RenameDeviceCommand): Promise<RenameDeviceView> {
    return this.#session.exclusive(async () => {
      const renamed = await this.#devices.renameDevice(command.device, command.name);
      return { ...renamed, session: this.#session.status().session };
    });
  }
}
