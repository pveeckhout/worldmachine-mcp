import type {
  SetDeviceBypassedCommand,
  SetDeviceBypassedCommandPort,
  SetDeviceBypassedView,
} from '../port/in/command/set-device-bypassed-command.js';
import type { DeviceEditPort } from '../port/out/device-edit-port.js';
import type { WorldMachineSessionPort } from '../port/out/world-machine-session-port.js';

export class SetDeviceBypassedService implements SetDeviceBypassedCommandPort {
  readonly #session: WorldMachineSessionPort;
  readonly #devices: DeviceEditPort;

  constructor(session: WorldMachineSessionPort, devices: DeviceEditPort) {
    this.#session = session;
    this.#devices = devices;
  }

  setDeviceBypassed(command: SetDeviceBypassedCommand): Promise<SetDeviceBypassedView> {
    return this.#session.exclusive(async () => {
      const state = await this.#devices.setDeviceBypassed(command.device, command.bypassed);
      return { ...state, session: this.#session.status().session };
    });
  }
}
