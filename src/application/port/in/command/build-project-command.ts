import type { BuildMode } from '../../../../domain/build.js';
import type { SessionSummary } from '../../../../domain/session.js';

export type BuildProjectCommand = {
  readonly mode: BuildMode;
  /** How long to wait for the end, 0 to 600 s (spec v2a section 4). */
  readonly waitSeconds: number;
  /** Ends the wait early (the client cancelled the call); the build keeps running. */
  readonly signal?: AbortSignal;
  /** Called every 5 s of the wait with the seconds since the build started. */
  readonly onProgress?: (elapsedSeconds: number) => void;
};
export type BuildProjectView = {
  readonly state: 'finished' | 'running';
  readonly mode: BuildMode;
  readonly elapsedSeconds: number;
  /** Tiled builds only: the folders the tiles are written to. */
  readonly outputFolders?: readonly string[];
  readonly session: SessionSummary;
};
export interface BuildProjectCommandPort {
  buildProject(command: BuildProjectCommand): Promise<BuildProjectView>;
}
