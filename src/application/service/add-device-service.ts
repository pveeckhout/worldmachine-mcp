import type {
  AddDeviceCommand,
  AddDeviceCommandPort,
  AddDeviceView,
} from '../port/in/command/add-device-command.js';
import type { DeviceEditPort } from '../port/out/device-edit-port.js';
import type { WorldMachineSessionPort } from '../port/out/world-machine-session-port.js';

export class AddDeviceService implements AddDeviceCommandPort {
  readonly #session: WorldMachineSessionPort;
  readonly #devices: DeviceEditPort;

  constructor(session: WorldMachineSessionPort, devices: DeviceEditPort) {
    this.#session = session;
    this.#devices = devices;
  }

  /** The edit port runs its own `device list` inside this exclusive section (spec section 6, ruling C1). */
  addDevice(command: AddDeviceCommand): Promise<AddDeviceView> {
    return this.#session.exclusive(async () => {
      const device = await this.#devices.addDevice(command.type, command.name);
      return { device, session: this.#session.status().session };
    });
  }
}
