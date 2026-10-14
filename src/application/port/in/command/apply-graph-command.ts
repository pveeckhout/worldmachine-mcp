import type { ErrorCode } from '../../../../domain/errors.js';
import type { DiffEntry } from '../../../../domain/graph-diff.js';
import type { PlanStep } from '../../../../domain/graph-plan.js';
import type { RawGraphSpec } from '../../../../domain/graph-spec.js';
import type { SessionSummary } from '../../../../domain/session.js';

export type ApplyGraphCommand = {
  readonly spec: RawGraphSpec;
  readonly planId: string;
  readonly keepSnapshot: boolean;
};
export type ApplyGraphView = {
  readonly applied: number;
  /** The kept snapshot's name; null when it was deleted or none was taken. */
  readonly snapshot: string | null;
  readonly diff: readonly DiffEntry[];
  /** Set when every step was applied but the result could not be read back; diff is then empty and the snapshot kept. */
  readonly diffError?: string;
  /** Unidentifiable-wires design section 4: `unidentifiableWires` of the plan this call applied. */
  readonly unidentifiableWires: readonly string[];
  /** Wire-loops design section 4: `possibleLoops` of the plan this call applied. */
  readonly possibleLoops: readonly string[];
  readonly session: SessionSummary;
};
export type FailedStep = {
  readonly index: number;
  readonly step: PlanStep;
  readonly code: ErrorCode;
  readonly message: string;
  readonly worldMachineMessage?: string;
};
/** The details of an `APPLY_FAILED` error (spec v3 section 6). */
export type ApplyFailureDetails = {
  readonly failedStep: FailedStep;
  readonly completedSteps: number;
  readonly rolledBack: boolean;
  readonly snapshot: string;
};
export interface ApplyGraphCommandPort {
  applyGraph(command: ApplyGraphCommand): Promise<ApplyGraphView>;
}
