import type {
  InspectProjectQuery,
  InspectProjectQueryPort,
  ProjectView,
} from '../port/in/query/inspect-project-query.js';
import type { ProjectGraphReadPort } from '../port/out/project-graph-read-port.js';
import type { WorldMachineSessionPort } from '../port/out/world-machine-session-port.js';

export class InspectProjectService implements InspectProjectQueryPort {
  readonly #session: WorldMachineSessionPort;
  readonly #graph: ProjectGraphReadPort;

  constructor(session: WorldMachineSessionPort, graph: ProjectGraphReadPort) {
    this.#session = session;
    this.#graph = graph;
  }

  async inspectProject(_query: InspectProjectQuery): Promise<ProjectView> {
    const project = await this.#graph.inspectProject();
    return { project, session: this.#session.status().session };
  }
}
