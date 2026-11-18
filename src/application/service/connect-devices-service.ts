import { WorldMachineError } from '../../domain/errors.js';
import type {
  ConnectDevicesCommand,
  ConnectDevicesCommandPort,
  ConnectDevicesView,
} from '../port/in/command/connect-devices-command.js';
import type { WireEditPort } from '../port/out/wire-edit-port.js';
import type { WorldMachineSessionPort } from '../port/out/world-machine-session-port.js';
import type { WireVerdicts } from './wire-verdicts.js';

export class ConnectDevicesService implements ConnectDevicesCommandPort {
  readonly #session: WorldMachineSessionPort;
  readonly #wires: WireEditPort;
  readonly #verdicts: WireVerdicts;

  constructor(session: WorldMachineSessionPort, wires: WireEditPort, verdicts: WireVerdicts) {
    this.#session = session;
    this.#wires = wires;
    this.#verdicts = verdicts;
  }

  connectDevices(command: ConnectDevicesCommand): Promise<ConnectDevicesView> {
    return this.#session.exclusive(async () => {
      let wire: Awaited<ReturnType<WireEditPort['connect']>>;
      try {
        wire = await this.#wires.connect(command.source, command.destination);
      } catch (error) {
        const verdict = this.#verdicts.observeRefusal(error, 'connect_devices');
        if (verdict === undefined || !(error instanceof WorldMachineError)) throw error;
        throw new WorldMachineError(error.code, error.message, error.worldMachineMessage, {
          ...error.details,
          verdict,
        });
      }
      // The typing is the catalog's prediction, not part of the result; the verdict is.
      const { typing, ...shown } = wire;
      const verdict = this.#verdicts.observe(typing, 'accepted', 'connect_devices');
      return {
        ...shown,
        ...(verdict === undefined ? {} : { verdict }),
        session: this.#session.status().session,
      };
    });
  }
}
