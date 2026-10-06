import type { SessionSummary } from '../../../../domain/session.js';

export type ExportOutputsCommand = Readonly<Record<string, never>>;
export type ExportOutputsView = {
  /** The paths World Machine reports, one per listed output. */
  readonly files: readonly string[];
  /** Present when a Material Output was exported: it writes four files per listed path (fact 50). */
  readonly note?: string;
  readonly session: SessionSummary;
};
export interface ExportOutputsCommandPort {
  exportOutputs(command: ExportOutputsCommand): Promise<ExportOutputsView>;
}
