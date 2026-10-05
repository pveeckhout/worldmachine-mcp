import type {
  DisconnectDevicesCommand,
  DisconnectDevicesCommandPort,
  DisconnectDevicesView,
} from '../port/in/command/disconnect-devices-command.js';
import type { WireEditPort } from '../port/out/wire-edit-port.js';
import type { WorldMachineSessionPort } from '../port/out/world-machine-session-port.js';

export class DisconnectDevicesService implements DisconnectDevicesCommandPort {
  readonly #session: WorldMachineSessionPort;
  readonly #wires: WireEditPort;

  constructor(session: WorldMachineSessionPort, wires: WireEditPort) {
    this.#session = session;
    this.#wires = wires;
  }

  disconnectDevices(command: DisconnectDevicesCommand): Promise<DisconnectDevicesView> {
    return this.#session.exclusive(async () => {
      const wire = await this.#wires.disconnect(command.source, command.destination);
      return { ...wire, session: this.#session.status().session };
    });
  }
}
