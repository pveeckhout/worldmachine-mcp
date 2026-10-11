import type { PlanConflict, PlanStep } from '../../../../domain/graph-plan.js';
import type { RawGraphSpec } from '../../../../domain/graph-spec.js';
import type { SessionSummary } from '../../../../domain/session.js';

export type PlanGraphQuery = { readonly spec: RawGraphSpec };
export type PlanGraphView = {
  readonly planId: string;
  readonly conflicts: readonly PlanConflict[];
  readonly steps: readonly PlanStep[];
  readonly unchanged: readonly string[];
  readonly session: SessionSummary;
};
export interface PlanGraphQueryPort {
  planGraph(query: PlanGraphQuery): Promise<PlanGraphView>;
}
