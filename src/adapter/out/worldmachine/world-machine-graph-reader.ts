import type { ProjectGraphReadPort } from '../../../application/port/out/project-graph-read-port.js';
import type { DeviceSummary } from '../../../domain/device.js';
import { buildCommand } from './command-builder.js';
import { parseDeviceList } from './parsers/device-list.js';
import { throwIfFailed } from './raw-response.js';
import type { WorldMachineSession } from './world-machine-session.js';

export class WorldMachineGraphReader implements ProjectGraphReadPort {
  readonly #session: WorldMachineSession;

  constructor(session: WorldMachineSession) {
    this.#session = session;
  }

  async listDevices(filter?: string): Promise<DeviceSummary[]> {
    const command =
      filter === undefined ? buildCommand(['device', 'list']) : buildCommand(['device', 'list'], filter);
    const response = await this.#session.executeOne(command);
    throwIfFailed(response);
    return parseDeviceList(response.output, filter !== undefined);
  }
}
