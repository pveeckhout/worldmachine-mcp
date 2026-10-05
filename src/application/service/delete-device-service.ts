import type {
  DeleteDeviceCommand,
  DeleteDeviceCommandPort,
  DeleteDeviceView,
} from '../port/in/command/delete-device-command.js';
import type { DeviceEditPort } from '../port/out/device-edit-port.js';
import type { WorldMachineSessionPort } from '../port/out/world-machine-session-port.js';

export class DeleteDeviceService implements DeleteDeviceCommandPort {
  readonly #session: WorldMachineSessionPort;
  readonly #devices: DeviceEditPort;

  constructor(session: WorldMachineSessionPort, devices: DeviceEditPort) {
    this.#session = session;
    this.#devices = devices;
  }

  deleteDevice(command: DeleteDeviceCommand): Promise<DeleteDeviceView> {
    return this.#session.exclusive(async () => {
      const deleted = await this.#devices.deleteDevice(command.device);
      return { deleted, session: this.#session.status().session };
    });
  }
}
