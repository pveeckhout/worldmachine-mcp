import type {
  ConnectDevicesCommand,
  ConnectDevicesCommandPort,
  ConnectDevicesView,
} from '../port/in/command/connect-devices-command.js';
import type { WireEditPort } from '../port/out/wire-edit-port.js';
import type { WorldMachineSessionPort } from '../port/out/world-machine-session-port.js';

export class ConnectDevicesService implements ConnectDevicesCommandPort {
  readonly #session: WorldMachineSessionPort;
  readonly #wires: WireEditPort;

  constructor(session: WorldMachineSessionPort, wires: WireEditPort) {
    this.#session = session;
    this.#wires = wires;
  }

  connectDevices(command: ConnectDevicesCommand): Promise<ConnectDevicesView> {
    return this.#session.exclusive(async () => {
      const wire = await this.#wires.connect(command.source, command.destination);
      return { ...wire, session: this.#session.status().session };
    });
  }
}
