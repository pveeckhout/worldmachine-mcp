import type { BuildStarter, RunMode } from '../../../../domain/build.js';
import type { SessionSummary } from '../../../../domain/session.js';

export type GetBuildStatusQuery = Readonly<Record<string, never>>;
export type RunningBuildView = {
  /** `unknown` only for a run World Machine started whose kind has not shown (spec v2a section 3). */
  readonly mode: RunMode;
  readonly elapsedSeconds: number;
  readonly startedBy: BuildStarter;
};
export type BuildStatusView = {
  readonly build: RunningBuildView | null;
  readonly previewRunning: boolean;
  readonly session: SessionSummary;
};
export interface GetBuildStatusQueryPort {
  getBuildStatus(query: GetBuildStatusQuery): Promise<BuildStatusView>;
}
