import type { BuildStarter, RunMode } from '../../../../domain/build.js';
import type { StoppedDevice, UnbuiltOutput } from '../../../../domain/build-result.js';
import type { SessionSummary } from '../../../../domain/session.js';

export type GetBuildStatusQuery = Readonly<Record<string, never>>;
export type RunningBuildView = {
  /** `unknown` only for a run World Machine started whose kind has not shown (spec v2a section 3). */
  readonly mode: RunMode;
  readonly elapsedSeconds: number;
  readonly startedBy: BuildStarter;
};
/**
 * Build-status-check design section 5: the last full build that build_project started, once checked. The fields are
 * those of build_project's view (build-not-built design section 5), or `outputsCheckError` instead of them.
 */
export type LastFullBuildView = {
  /** ISO 8601: the run the result belongs to. */
  readonly startedAt: string;
  readonly outputsBuilt?: boolean;
  readonly notBuilt?: readonly UnbuiltOutput[];
  readonly stoppedAt?: readonly StoppedDevice[];
  /** Only when `outputsBuilt` is false. */
  readonly hint?: string;
  /** Why the check failed or was skipped (design section 3); the four fields above are absent then. */
  readonly outputsCheckError?: string;
};
export type BuildStatusView = {
  readonly build: RunningBuildView | null;
  readonly previewRunning: boolean;
  /** Absent while a build runs and until the last full build is checked (design section 5). */
  readonly lastFullBuild?: LastFullBuildView;
  readonly session: SessionSummary;
};
export interface GetBuildStatusQueryPort {
  getBuildStatus(query: GetBuildStatusQuery): Promise<BuildStatusView>;
}
