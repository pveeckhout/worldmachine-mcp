import type {
  ListExportsQuery,
  ListExportsQueryPort,
  ListExportsView,
} from '../port/in/query/list-exports-query.js';
import type { ExportPort } from '../port/out/export-port.js';
import type { PathPolicyPort } from '../port/out/path-policy-port.js';
import type { ProjectGraphReadPort } from '../port/out/project-graph-read-port.js';
import type { WorldMachineSessionPort } from '../port/out/world-machine-session-port.js';
import { checkExportTargets, type ExportCheckPorts } from './export-rules.js';

export class ListExportsService implements ListExportsQueryPort {
  readonly #ports: ExportCheckPorts;

  constructor(
    session: WorldMachineSessionPort,
    exports: ExportPort,
    graph: ProjectGraphReadPort,
    policy: PathPolicyPort,
  ) {
    this.#ports = { session, exports, graph, policy };
  }

  async listExports(_query: ListExportsQuery): Promise<ListExportsView> {
    const check = await checkExportTargets(this.#ports, 'export');
    return { ...check, session: this.#ports.session.status().session };
  }
}
