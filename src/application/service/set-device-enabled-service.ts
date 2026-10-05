import type {
  SetDeviceEnabledCommand,
  SetDeviceEnabledCommandPort,
  SetDeviceEnabledView,
} from '../port/in/command/set-device-enabled-command.js';
import type { DeviceEditPort } from '../port/out/device-edit-port.js';
import type { WorldMachineSessionPort } from '../port/out/world-machine-session-port.js';

export class SetDeviceEnabledService implements SetDeviceEnabledCommandPort {
  readonly #session: WorldMachineSessionPort;
  readonly #devices: DeviceEditPort;

  constructor(session: WorldMachineSessionPort, devices: DeviceEditPort) {
    this.#session = session;
    this.#devices = devices;
  }

  setDeviceEnabled(command: SetDeviceEnabledCommand): Promise<SetDeviceEnabledView> {
    return this.#session.exclusive(async () => {
      const state = await this.#devices.setDeviceEnabled(command.device, command.enabled);
      return { ...state, session: this.#session.status().session };
    });
  }
}
