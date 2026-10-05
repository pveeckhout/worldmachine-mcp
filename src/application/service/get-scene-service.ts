import type { GetSceneQuery, GetSceneQueryPort, SceneView } from '../port/in/query/get-scene-query.js';
import type { ProjectGraphReadPort } from '../port/out/project-graph-read-port.js';
import type { WorldMachineSessionPort } from '../port/out/world-machine-session-port.js';

export class GetSceneService implements GetSceneQueryPort {
  readonly #session: WorldMachineSessionPort;
  readonly #graph: ProjectGraphReadPort;

  constructor(session: WorldMachineSessionPort, graph: ProjectGraphReadPort) {
    this.#session = session;
    this.#graph = graph;
  }

  async getScene(_query: GetSceneQuery): Promise<SceneView> {
    const scene = await this.#graph.getScene();
    return { scene, session: this.#session.status().session };
  }
}
