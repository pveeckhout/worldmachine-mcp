import type {
  DeviceListView,
  ListDevicesQuery,
  ListDevicesQueryPort,
} from '../port/in/query/list-devices-query.js';
import type { ProjectGraphReadPort } from '../port/out/project-graph-read-port.js';
import type { WorldMachineSessionPort } from '../port/out/world-machine-session-port.js';

export class ListDevicesService implements ListDevicesQueryPort {
  readonly #session: WorldMachineSessionPort;
  readonly #graph: ProjectGraphReadPort;

  constructor(session: WorldMachineSessionPort, graph: ProjectGraphReadPort) {
    this.#session = session;
    this.#graph = graph;
  }

  /** The graph port starts World Machine itself, after validating the command, so a refused filter launches nothing. */
  async listDevices(query: ListDevicesQuery): Promise<DeviceListView> {
    const devices = await this.#graph.listDevices(query.filter);
    return { devices, session: this.#session.status().session };
  }
}
