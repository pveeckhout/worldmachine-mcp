import {
  type BuildEvent,
  type BuildRun,
  type BuildState,
  isRunning,
  NO_BUILD,
  nextBuildState,
  type TrackedBuildMode,
} from '../../../domain/build.js';
import { WorldMachineError } from '../../../domain/errors.js';

export const BUILD_EXITED = 'World Machine exited during the build';

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

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  get running(): boolean {
    return isRunning(this.#state);
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
    const wasRunning = this.running;
    this.#set(nextBuildState(this.#state, event, this.#now()));
    if (wasRunning && !this.running) for (const listener of this.#endListeners) listener();
  }

  /**
   * Stops tracking the running run, as if it ended: `stop_build` gives up on a run World Machine started that showed
   * no end, so a stray event cannot block the change tools until World Machine restarts (spec v2a section 4).
   */
  forget(): void {
    if (this.#dropped || !this.running) return;
    this.#set({ ...this.#state, run: undefined });
    for (const listener of this.#endListeners) listener();
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
    this.#state = NO_BUILD;
    for (const waiter of [...this.#waiters]) waiter.settle(new WorldMachineError('CRASHED', BUILD_EXITED));
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
