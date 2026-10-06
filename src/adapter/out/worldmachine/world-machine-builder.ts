import type { BuildPort } from '../../../application/port/out/build-port.js';
import type { BuildMode, BuildRun, RunMode } from '../../../domain/build.js';
import { WorldMachineError } from '../../../domain/errors.js';
import { BUILD_EXITED } from './build-tracker.js';
import { requireLine } from './edit-checks.js';
import { unexpectedOutput } from './parsers/unexpected.js';
import { throwIfFailed } from './raw-response.js';
import type { WorldMachineSession } from './world-machine-session.js';

export type BuilderOptions = {
  /** How long a full or tiled start may take to show its first build event (spec v2a section 5: 5 s). */
  readonly confirmMs?: number;
  /** How often a preview's end is polled with `build status` (spec v2a section 5: once a second). */
  readonly pollMs?: number;
};

// raw/v2-build-export.txt l.22-28, raw/v2-build-long.txt l.62-63.
const PREVIEW_STARTED = 'Preview build started.';
const STOP_REQUESTED = 'Stop requested.';
const IN_PROGRESS = 'Build in progress...';
const NOT_RUNNING = 'No build running.';

export class WorldMachineBuilder implements BuildPort {
  readonly #session: WorldMachineSession;
  readonly #confirmMs: number;
  readonly #pollMs: number;

  constructor(session: WorldMachineSession, options: BuilderOptions = {}) {
    this.#session = session;
    this.#confirmMs = options.confirmMs ?? 5_000;
    this.#pollMs = options.pollMs ?? 1_000;
  }

  current(): BuildRun | undefined {
    const run = this.#session.buildTracker()?.snapshot();
    return run?.state === 'running' ? run : undefined;
  }

  async start(mode: BuildMode): Promise<void> {
    this.#session.assertAcceptingCalls();
    if (mode === 'preview') {
      const response = await this.#session.executeOne('build preview');
      throwIfFailed(response);
      requireLine(response, PREVIEW_STARTED, 'build preview');
      return;
    }
    await this.#session.ensureRunning();
    const tracker = this.#session.buildTracker();
    if (tracker === undefined) throw new WorldMachineError('CRASHED', 'World Machine is not running');
    tracker.expect(mode);
    let output: readonly string[] = [];
    const confirmed = await this.#untilSettled(async () => {
      try {
        const response = await this.#session.executeOne(
          mode === 'full' ? 'build start' : 'build start tiled',
        );
        output = response.output;
        throwIfFailed(response);
        // Facts 43 and 48: the start frame holds only build events, which the process took out of it, so the
        // confirmation is the run's opening event.
        return await tracker.started(this.#confirmMs);
      } finally {
        // Every exit, thrown or not, forgets the expected start, so an unbounded `started()` wait settles.
        tracker.cancelExpectation();
      }
    });
    if (confirmed) return;
    throw new WorldMachineError(
      'UNEXPECTED_OUTPUT',
      `World Machine did not report the start of the ${mode} build within ${this.#confirmMs} ms`,
      output.length > 0 ? output.join('\n') : undefined,
    );
  }

  async awaitStart(): Promise<void> {
    const tracker = this.#session.buildTracker();
    if (tracker?.pending === undefined) return;
    // No bound of its own: the start attempt clears `pending` in its `finally` when it settles, confirmed, failed,
    // or timed out, so this wait cannot end before the start does (spec v2a section 4).
    await this.#untilSettled(() => tracker.started());
  }

  async previewRunning(): Promise<boolean> {
    this.#session.assertAcceptingCalls();
    // get_build_status never launches World Machine (spec v2a section 4).
    if (this.#session.status().session.state !== 'ready') return false;
    const response = await this.#session.executeOne('build status');
    throwIfFailed(response);
    if (response.output.includes(IN_PROGRESS)) return true;
    if (response.output.includes(NOT_RUNNING)) return false;
    throw unexpectedOutput('build status', response.output);
  }

  async stop(): Promise<void> {
    this.#session.assertAcceptingCalls();
    const response = await this.#session.executeOne('build stop');
    throwIfFailed(response);
    requireLine(response, STOP_REQUESTED, 'build stop');
  }

  forgetRun(): void {
    this.#session.buildTracker()?.forget();
  }

  async waitForEnd(mode: BuildMode | RunMode, ms: number, signal?: AbortSignal): Promise<boolean> {
    return this.#untilSettled(async () =>
      mode === 'preview' ? this.#pollPreview(ms, signal) : this.#trackedEnd(ms, signal),
    );
  }

  /**
   * Runs a wait. A shutdown ends World Machine and the wait with it, and the shutdown's own `build stop` ends a run
   * as well; both are SHUTTING_DOWN, not a crash or a missing confirmation (decision D14), on a failure and after
   * a success alike.
   */
  async #untilSettled<T>(wait: () => Promise<T>): Promise<T> {
    let result: T;
    try {
      result = await wait();
    } catch (error) {
      this.#session.assertAcceptingCalls();
      throw error;
    }
    this.#session.assertAcceptingCalls();
    return result;
  }

  #trackedEnd(ms: number, signal: AbortSignal | undefined): Promise<boolean> {
    const tracker = this.#session.buildTracker();
    if (tracker === undefined) throw new WorldMachineError('CRASHED', BUILD_EXITED);
    return tracker.ended(ms, signal);
  }

  async #pollPreview(ms: number, signal: AbortSignal | undefined): Promise<boolean> {
    const deadline = Date.now() + ms;
    for (;;) {
      // A poll must not start World Machine again after it exited (spec v2a section 7: CRASHED).
      if (this.#session.status().session.state !== 'ready')
        throw new WorldMachineError('CRASHED', BUILD_EXITED);
      if (!(await this.previewRunning())) return true;
      const left = deadline - Date.now();
      if (left <= 0 || !(await pause(Math.min(this.#pollMs, left), signal))) return false;
    }
  }
}

/** Waits `ms`; false when `signal` aborts first. */
function pause(ms: number, signal: AbortSignal | undefined): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
