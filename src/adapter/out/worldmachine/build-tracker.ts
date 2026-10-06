import {
  type BuildEvent,
  type BuildRun,
  type BuildState,
  isRunning,
  lateStartMissed,
  NO_BUILD,
  nextBuildState,
  type TrackedBuildMode,
} from '../../../domain/build.js';
import { WorldMachineError } from '../../../domain/errors.js';

export const BUILD_EXITED = 'World Machine exited during the build';
/** Spec v2a section 3: how long an ending full run waits for its late `Build started.` before it ends anyway. */
export const LATE_START_MS = 10_000;

type Waiter = {
  readonly done: () => boolean;
  readonly settle: (result: boolean | WorldMachineError) => void;
};

/**
 * Spec v2a section 5: the current `BuildRun` of one World Machine process, driven by its build events. The session
 * creates one per process; the process's exit drops it.
 */
export class BuildTracker {
  readonly #now: () => number;
  readonly #waiters = new Set<Waiter>();
  readonly #endListeners: (() => void)[] = [];
  #state: BuildState = NO_BUILD;
  #dropped = false;
  #lateStartTimer: NodeJS.Timeout | undefined;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  get running(): boolean {
    return isRunning(this.#state);
  }

  /** true once the process exited (`drop()`). */
  get dropped(): boolean {
    return this.#dropped;
  }

  /** The start the server sent whose opening event has not arrived yet (decision D4); `started()` waits for it. */
  get pending(): TrackedBuildMode | undefined {
    return this.#state.pending;
  }

  /** The last run, running or ended; undefined before the first one and after the process exited. */
  snapshot(): BuildRun | undefined {
    return this.#state.run;
  }

  /** Called before the server sends `build start` or `build start tiled`; the run's opening event confirms it. */
  expect(mode: TrackedBuildMode): void {
    this.#set({ ...this.#state, pending: mode });
  }

  cancelExpectation(): void {
    this.#set({ ...this.#state, pending: undefined });
  }

  apply(event: BuildEvent): void {
    if (this.#dropped) return;
    this.#transition(nextBuildState(this.#state, event, this.#now()));
  }

  /**
   * Stops tracking the running run, as if it ended: `stop_build` gives up on a run World Machine started that showed
   * no end, so a stray event cannot block the change tools until World Machine restarts (spec v2a section 4).
   */
  forget(): void {
    if (this.#dropped || !this.running) return;
    this.#transition({ ...this.#state, run: undefined, lateStartsOwed: 0, ending: false });
  }

  /** Runs each time a running run ends; not when the process exits. */
  onEnd(listener: () => void): void {
    this.#endListeners.push(listener);
  }

  /**
   * true once the expected start was confirmed by its event or cancelled; false after `ms`. Without `ms` there is no
   * bound: the start attempt cancels its expectation when it settles (spec v2a section 4, `stop_build`).
   */
  started(ms?: number): Promise<boolean> {
    return this.#waitFor(() => this.#state.pending === undefined, ms);
  }

  /**
   * true once no run is running (at once when none is); false after `ms` or when `signal` aborts. Rejects with
   * CRASHED when the process exits first.
   */
  ended(ms: number, signal?: AbortSignal): Promise<boolean> {
    return this.#waitFor(() => !this.running, ms, signal);
  }

  /** The process exited: the run is dropped and every waiter fails with CRASHED. */
  drop(): void {
    this.#dropped = true;
    this.#clearLateStartTimer();
    this.#state = NO_BUILD;
    for (const waiter of [...this.#waiters]) waiter.settle(new WorldMachineError('CRASHED', BUILD_EXITED));
  }

  /** Sets the state, arms or clears the late-line timer of an ending run, and calls the end listeners. */
  #transition(next: BuildState): void {
    const wasRunning = this.running;
    const wasEnding = this.#state.ending;
    this.#set(next);
    if (next.ending && !wasEnding) {
      this.#lateStartTimer = setTimeout(() => {
        this.#lateStartTimer = undefined;
        this.#transition(lateStartMissed(this.#state));
      }, LATE_START_MS);
    } else if (!next.ending) {
      this.#clearLateStartTimer();
    }
    if (wasRunning && !this.running) for (const listener of this.#endListeners) listener();
  }

  #clearLateStartTimer(): void {
    clearTimeout(this.#lateStartTimer);
    this.#lateStartTimer = undefined;
  }

  #set(state: BuildState): void {
    this.#state = state;
    for (const waiter of [...this.#waiters]) if (waiter.done()) waiter.settle(true);
  }

  #waitFor(done: () => boolean, ms: number | undefined, signal?: AbortSignal): Promise<boolean> {
    if (this.#dropped) return Promise.reject(new WorldMachineError('CRASHED', BUILD_EXITED));
    if (done()) return Promise.resolve(true);
    if (signal?.aborted) return Promise.resolve(false);
    return new Promise((resolve, reject) => {
      const onAbort = () => waiter.settle(false);
      const timer = ms === undefined ? undefined : setTimeout(() => waiter.settle(false), ms);
      const waiter: Waiter = {
        done,
        settle: (result) => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          this.#waiters.delete(waiter);
          if (result instanceof WorldMachineError) reject(result);
          else resolve(result);
        },
      };
      this.#waiters.add(waiter);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}
