import type { DeviceView, GetDeviceQuery, GetDeviceQueryPort } from '../port/in/query/get-device-query.js';
import type { ProjectGraphReadPort } from '../port/out/project-graph-read-port.js';
import type { WorldMachineSessionPort } from '../port/out/world-machine-session-port.js';

export class GetDeviceService implements GetDeviceQueryPort {
  readonly #session: WorldMachineSessionPort;
  readonly #graph: ProjectGraphReadPort;

  constructor(session: WorldMachineSessionPort, graph: ProjectGraphReadPort) {
    this.#session = session;
    this.#graph = graph;
  }

  async getDevice(query: GetDeviceQuery): Promise<DeviceView> {
    const device = await this.#graph.getDevice(query.device);
    return { device, session: this.#session.status().session };
  }
}
