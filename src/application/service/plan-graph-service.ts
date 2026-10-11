import { planGraph, planId } from '../../domain/graph-plan.js';
import { validateGraphSpec } from '../../domain/graph-spec.js';
import type { PlanGraphQuery, PlanGraphQueryPort, PlanGraphView } from '../port/in/query/plan-graph-query.js';
import type { ProjectGraphReadPort } from '../port/out/project-graph-read-port.js';
import type { WorldMachineSessionPort } from '../port/out/world-machine-session-port.js';
import { readGraphState } from './read-graph-state.js';

export class PlanGraphService implements PlanGraphQueryPort {
  readonly #session: WorldMachineSessionPort;
  readonly #graph: ProjectGraphReadPort;

  constructor(session: WorldMachineSessionPort, graph: ProjectGraphReadPort) {
    this.#session = session;
    this.#graph = graph;
  }

  /** A read: outside `exclusive()`, so a plan can be made while a build runs; apply_graph plans again (D18). */
  async planGraph(query: PlanGraphQuery): Promise<PlanGraphView> {
    const spec = validateGraphSpec(query.spec);
    const state = await readGraphState(spec, this.#graph, this.#session);
    const { conflicts, steps, unchanged } = planGraph(spec, state);
    return {
      planId: planId(spec, state),
      conflicts,
      steps,
      unchanged,
      session: this.#session.status().session,
    };
  }
}
