import type { BuildMode } from '../../../../domain/build.js';
import type { Group } from '../../../../domain/group.js';
import type { SessionSummary } from '../../../../domain/session.js';

export type BuildProjectCommand = {
  readonly mode: BuildMode;
  /** Mode `group` only, and required there: a group name or `#<index>` (spec v2b section 3). */
  readonly group?: string;
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
  /** Group builds only: the group that was built (spec v2b section 3, decision D5). */
  readonly group?: Group;
  readonly session: SessionSummary;
};
export interface BuildProjectCommandPort {
  buildProject(command: BuildProjectCommand): Promise<BuildProjectView>;
}
