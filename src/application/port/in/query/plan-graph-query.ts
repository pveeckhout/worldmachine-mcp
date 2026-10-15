import type { PlanConflict, PlanStep } from '../../../../domain/graph-plan.js';
import type { RawGraphSpec } from '../../../../domain/graph-spec.js';
import type { TemplateArgument } from '../../../../domain/graph-template.js';
import type { SessionSummary } from '../../../../domain/session.js';

/** Templates design section 3: a template file and the arguments for its declared parameters. */
export type GraphTemplateRef = {
  readonly path: string;
  readonly parameters?: Readonly<Record<string, TemplateArgument>>;
};
export type PlanGraphQuery = { readonly spec?: RawGraphSpec; readonly template?: GraphTemplateRef };
export type PlanGraphView = {
  readonly planId: string;
  readonly conflicts: readonly PlanConflict[];
  readonly steps: readonly PlanStep[];
  readonly unchanged: readonly string[];
  /** Port-types design section 6: the planned wires with an untyped end, as `'<destination>' input <port>`. */
  readonly uncheckedWires: readonly string[];
  /** Unidentifiable-wires design section 4: the wires into managed devices a later plan could not identify. */
  readonly unidentifiableWires: readonly string[];
  /** Wire-loops design section 4: the wires that may close a loop through wires the plan cannot tell apart. */
  readonly possibleLoops: readonly string[];
  /** Templates design section 3: the filled spec, only when the call gave a template. */
  readonly spec?: RawGraphSpec;
  readonly session: SessionSummary;
};
export interface PlanGraphQueryPort {
  planGraph(query: PlanGraphQuery): Promise<PlanGraphView>;
}
