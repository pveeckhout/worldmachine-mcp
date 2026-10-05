import type {
  UpdateDeviceParametersCommand,
  UpdateDeviceParametersCommandPort,
  UpdateDeviceParametersView,
} from '../port/in/command/update-device-parameters-command.js';
import type { ParameterEditPort } from '../port/out/parameter-edit-port.js';
import type { WorldMachineSessionPort } from '../port/out/world-machine-session-port.js';

export class UpdateDeviceParametersService implements UpdateDeviceParametersCommandPort {
  readonly #session: WorldMachineSessionPort;
  readonly #parameters: ParameterEditPort;

  constructor(session: WorldMachineSessionPort, parameters: ParameterEditPort) {
    this.#session = session;
    this.#parameters = parameters;
  }

  updateDeviceParameters(command: UpdateDeviceParametersCommand): Promise<UpdateDeviceParametersView> {
    return this.#session.exclusive(async () => {
      const update = await this.#parameters.updateParameters(command.device, command.parameters);
      return { ...update, session: this.#session.status().session };
    });
  }
}
