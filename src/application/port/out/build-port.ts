import type { BuildMode, BuildRun, RunMode } from '../../../domain/build.js';

/** Builds (spec v2a sections 4-5). Only `previewRunning` and `waitForEnd` for a preview read World Machine's status. */
export interface BuildPort {
  /** The running full or tiled build, from World Machine's build events; sends nothing and never launches. */
  current(): BuildRun | undefined;
  /** Starts a build and waits for World Machine's confirmation, not for the end. */
  start(mode: BuildMode): Promise<void>;
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
