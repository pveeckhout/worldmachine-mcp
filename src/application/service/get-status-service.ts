import type { GetStatusQuery, GetStatusQueryPort, StatusView } from '../port/in/query/get-status-query.js';
import type { WorldMachineSessionPort } from '../port/out/world-machine-session-port.js';

export class GetStatusService implements GetStatusQueryPort {
  readonly #session: WorldMachineSessionPort;

  constructor(session: WorldMachineSessionPort) {
    this.#session = session;
  }

  async getStatus(_query: GetStatusQuery): Promise<StatusView> {
    const status = this.#session.status();
    return {
      configured: status.executable !== null,
      executable: status.executable,
      ...(status.systemInfo
        ? { build: status.systemInfo.build, buildName: status.systemInfo.buildName }
        : {}),
      session: status.session,
    };
  }
}
