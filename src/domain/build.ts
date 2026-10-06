/** Spec v2a section 3. A preview is visible only to `build status` (fact 42); full and tiled builds only through their events (fact 44). */
export type BuildMode = 'preview' | 'full' | 'tiled';
export type TrackedBuildMode = Exclude<BuildMode, 'preview'>;

/** The six unsolicited build lines of facts 43 and 48. */
export type BuildEvent =
  | 'sleep-prohibited'
  | 'starting'
  | 'ended'
  | 'sleep-allowed'
  | 'build-started'
  | 'tiled-started';

export type BuildStarter = 'server' | 'world-machine';

/** A run's mode; `unknown` while a run World Machine started has shown only its `sleep-prohibited` (spec section 3). */
export type RunMode = TrackedBuildMode | 'unknown';

export type BuildRun = {
  /** Milliseconds since the epoch at which the opening event arrived. */
  readonly startedAt: number;
  readonly state: 'running' | 'ended';
} & (
  | { readonly mode: TrackedBuildMode; readonly startedBy: BuildStarter }
  | { readonly mode: 'unknown'; readonly startedBy: 'world-machine' }
);

/**
 * The last run, the start command the server sent whose opening event has not arrived yet, and whether an ended full
 * run's `sleep-allowed` trailer is still to come.
 */
export type BuildState = {
  readonly run: BuildRun | undefined;
  readonly pending: TrackedBuildMode | undefined;
  readonly trailerOwed: boolean;
};

export const NO_BUILD: BuildState = { run: undefined, pending: undefined, trailerOwed: false };

export function isRunning(state: BuildState): boolean {
  return state.run?.state === 'running';
}

/** The `BuildRun` transitions of spec v2a section 3. `now` stamps a run that this event opens. */
export function nextBuildState(state: BuildState, event: BuildEvent, now: number): BuildState {
  const { run, pending, trailerOwed } = state;
  switch (event) {
    case 'starting':
      // Fact 45: a start while a full build runs ends that build and opens a new run in the same frame.
      if (pending === 'full') {
        return {
          run: { mode: 'full', startedAt: now, startedBy: 'server', state: 'running' },
          pending: undefined,
          trailerOwed,
        };
      }
      // Without a pending server start, the build was started in the World Machine window (assumption A1): this
      // event shows a provisional run to be full, or opens the run when none is open.
      return {
        run:
          run?.state === 'running' && run.mode === 'unknown'
            ? { ...run, mode: 'full' }
            : { mode: 'full', startedAt: now, startedBy: 'world-machine', state: 'running' },
        pending,
        trailerOwed,
      };
    case 'ended':
      // A full run's sleep-allowed trailer follows its Ended, possibly after the next run opened.
      return run?.state === 'running' && run.mode === 'full'
        ? { run: { ...run, state: 'ended' }, pending, trailerOwed: true }
        : state;
    case 'sleep-prohibited':
      // Fact 48: a tiled build prints no Starting event, so its first line opens the run the server asked for.
      if (pending === 'tiled') {
        return {
          run: { mode: 'tiled', startedAt: now, startedBy: 'server', state: 'running' },
          pending: undefined,
          trailerOwed,
        };
      }
      // Spec section 3, assumption A1: with no server start pending, a build was started in the World Machine window.
      // A tiled one shows no other event before its end, so the run opens now as provisional, mode unknown. A running
      // run is kept: no capture shows this line during a run without that run's Ended first.
      if (pending === undefined && run?.state !== 'running') {
        return {
          run: { mode: 'unknown', startedAt: now, startedBy: 'world-machine', state: 'running' },
          pending,
          trailerOwed,
        };
      }
      return state;
    case 'sleep-allowed':
      // After a full run's Ended this line is a trailer, and it can follow the opening of the next run
      // (raw/v2-build-long.txt l.57-60), so it is consumed first. It closes a tiled run, and a provisional one (A1).
      if (trailerOwed) return { ...state, trailerOwed: false };
      return run?.state === 'running' && run.mode !== 'full'
        ? { run: { ...run, state: 'ended' }, pending, trailerOwed }
        : state;
    case 'build-started':
    case 'tiled-started':
      // Late confirmations, printed after the build ended (facts 43, 48).
      return state;
    default: {
      // A new BuildEvent fails to compile here until it has a transition.
      const unhandled: never = event;
      return unhandled;
    }
  }
}
