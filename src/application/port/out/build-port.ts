import type { BuildMode, BuildRun, RunMode } from '../../../domain/build.js';
import type { Group } from '../../../domain/group.js';

/** Spec v2b section 3: the refusal of mode `group` without a group, shared by the service and the adapter. */
export const GROUP_BUILD_NEEDS_GROUP =
  'build_project with mode group needs group: a group name or #<index> (see list_groups)';

/** Builds (spec v2a sections 4-5). Only `previewRunning` and `waitForEnd` for a preview read World Machine's status. */
export interface BuildPort {
  /** The running full or tiled build, from World Machine's build events; sends nothing and never launches. */
  current(): BuildRun | undefined;
  /**
   * Starts a build and waits for World Machine's confirmation, not for the end. Mode `group` takes the group the
   * caller resolved inside the same `exclusive()` action and sends its index (spec v2b section 4).
   */
  start(mode: BuildMode, group?: Group): Promise<void>;
  /** Resolves once no full or tiled start waits for its opening event, so `current()` shows the run it opened. */
  awaitStart(): Promise<void>;
  /** `build status` (fact 42); false without sending anything when World Machine is not running. */
  previewRunning(): Promise<boolean>;
  /** `build stop`, confirmed by `Stop requested.` (fact 46). */
  stop(): Promise<void>;
  /** true once the build ended; false when `ms` passed or `signal` aborted first. A preview is polled once a second. */
  waitForEnd(mode: BuildMode | RunMode, ms: number, signal?: AbortSignal): Promise<boolean>;
  /** Stops tracking the running run: `stop_build`'s drop rule for a run World Machine started (spec v2a section 4). */
  forgetRun(): void;
}
