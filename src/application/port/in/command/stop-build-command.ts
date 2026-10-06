import type { BuildMode, RunMode } from '../../../../domain/build.js';
import type { SessionSummary } from '../../../../domain/session.js';

export type StopBuildCommand = Readonly<Record<string, never>>;
/** `unknown` only for a run World Machine started whose kind had not shown (spec v2a section 3). */
export type StopBuildView = {
  readonly stopped: BuildMode | RunMode | null;
  readonly session: SessionSummary;
};
export interface StopBuildCommandPort {
  stopBuild(command: StopBuildCommand): Promise<StopBuildView>;
}
