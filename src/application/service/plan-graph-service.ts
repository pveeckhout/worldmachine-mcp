import { planGraph, planId } from '../../domain/graph-plan.js';
import { validateGraphSpec } from '../../domain/graph-spec.js';
import { wireLoops } from '../../domain/wire-loops.js';
import { unidentifiableWires } from '../../domain/wire-prediction.js';
import type { PlanGraphQuery, PlanGraphQueryPort, PlanGraphView } from '../port/in/query/plan-graph-query.js';
import type { PortTypeCatalogPort } from '../port/out/port-type-catalog-port.js';
import type { ProjectGraphReadPort } from '../port/out/project-graph-read-port.js';
import type { WorldMachineSessionPort } from '../port/out/world-machine-session-port.js';
import { readGraphState } from './read-graph-state.js';
import { checkWireTypes } from './wire-types.js';

export class PlanGraphService implements PlanGraphQueryPort {
  readonly #session: WorldMachineSessionPort;
  readonly #graph: ProjectGraphReadPort;
  readonly #portTypes: PortTypeCatalogPort;

  constructor(session: WorldMachineSessionPort, graph: ProjectGraphReadPort, portTypes: PortTypeCatalogPort) {
    this.#session = session;
    this.#graph = graph;
    this.#portTypes = portTypes;
  }

  /** A read: outside `exclusive()`, so a plan can be made while a build runs; apply_graph plans again (D18). */
  async planGraph(query: PlanGraphQuery): Promise<PlanGraphView> {
    const spec = validateGraphSpec(query.spec);
    const state = await readGraphState(spec, this.#graph, this.#session);
    const { conflicts, steps, unchanged } = planGraph(spec, state);
    // Port-types design section 6: after the reads, which started World Machine if needed (plan decision D6).
    const types = checkWireTypes(spec, state, steps, this.#portTypes);
    // Wire-loops design section 4: a certain loop is a conflict, after the plan's and the type check's.
    const loops = wireLoops(spec, state, steps);
    return {
      planId: planId(spec, state),
      conflicts: [...conflicts, ...types.conflicts, ...loops.conflicts],
      steps,
      unchanged,
      uncheckedWires: types.uncheckedWires,
      unidentifiableWires: unidentifiableWires(spec, state, steps),
      possibleLoops: loops.possibleLoops,
      session: state.session,
    };
  }
}
