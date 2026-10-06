import type { PathPolicyPort } from '../../../application/port/out/path-policy-port.js';
import type {
  SessionStatus,
  WorldMachineSessionPort,
} from '../../../application/port/out/world-machine-session-port.js';
import { type ErrorCode, WorldMachineError } from '../../../domain/errors.js';
import { type ProjectBinding, type SessionState, summarize } from '../../../domain/session.js';
import type { SystemInfo } from '../../../domain/system-info.js';
import type { Logger } from '../../../logger.js';
import { BuildTracker } from './build-tracker.js';
import { buildCommand } from './command-builder.js';
import { CommandQueue } from './command-queue.js';
import { parseSystemInfo } from './parsers/system-info.js';
import { OPEN_FAILED, requireCreatedLine, requireOpenedLine } from './project-confirmations.js';
import { type RawResponse, requireFrame, throwIfFailed } from './raw-response.js';
import {
  DEFAULT_QUIT_GRACE_MS,
  KILL_ABORT,
  type QuitAbort,
  type WorldMachineProcess,
} from './world-machine-process.js';

export type SessionOptions = {
  readonly executable: string | null;
  readonly defaultProject: string | undefined;
  readonly pathPolicy: PathPolicyPort;
  readonly commandTimeoutMs: number;
  readonly idleTimeoutMs: number;
  readonly logger: Logger;
  readonly startProcess: (
    executable: string,
    signal: AbortSignal,
    onSpawn: (proc: WorldMachineProcess) => void,
  ) => Promise<WorldMachineProcess>;
};

/** How long each shutdown step may take; the main entry point derives it from the MCP client's kill budget. */
export type ShutdownBudget = { readonly drainMs: number; readonly graceMs: number; readonly termMs: number };

const SHUTTING_DOWN_MESSAGE = 'The server is shutting down';
const BUILD_RUNNING = 'A build is running; call stop_build or wait for it to finish';
const LOST_CHANGES = 'World Machine exited unexpectedly; unsaved changes were lost';
// Errors that describe the request or World Machine's answer, not the shutdown; they keep their code.
const KEEP_DURING_SHUTDOWN = new Set<ErrorCode>([
  'NOT_CONFIGURED',
  'REFUSED',
  'WM_COMMAND_FAILED',
  'UNEXPECTED_OUTPUT',
]);

export class WorldMachineSession implements WorldMachineSessionPort {
  readonly #options: SessionOptions;
  #state: SessionState = { kind: 'notRunning' };
  #starting: Promise<void> | undefined;
  #startAbort: AbortController | undefined;
  /** The process of a start that has spawned but is not ready yet; shutdown and kill cannot reach it otherwise. */
  #spawning: WorldMachineProcess | undefined;
  #stopping: Promise<void> | undefined;
  #process: WorldMachineProcess | undefined;
  readonly #quitting = new Set<WorldMachineProcess>();
  #queue: CommandQueue | undefined;
  /** The build events of the current process (spec v2a section 5); replaced with each new process. */
  #tracker: BuildTracker | undefined;
  #systemInfo: SystemInfo | undefined;
  #idleTimer: NodeJS.Timeout | undefined;
  #inFlight = 0;
  #shutDown = false;
  #exclusiveTail: Promise<unknown> = Promise.resolve();
  /** The project the next start opens instead of the default project (spec section 6); that start forgets it. */
  #reopen: string | undefined;

  constructor(options: SessionOptions) {
    this.#options = options;
  }

  status(): SessionStatus {
    return {
      executable: this.#options.executable,
      session: this.#shutDown ? { state: 'stopping' } : summarize(this.#state),
      ...(this.#systemInfo ? { systemInfo: this.#systemInfo } : {}),
    };
  }

  /** Throws SHUTTING_DOWN once shutdown began; callers check it before any precondition (spec section 6). */
  assertAcceptingCalls(): void {
    if (this.#shutDown) throw new WorldMachineError('SHUTTING_DOWN', SHUTTING_DOWN_MESSAGE);
  }

  forgetReopen(): void {
    this.#reopen = undefined;
  }

  /** The build tracker of the current World Machine process; undefined before the first start. */
  buildTracker(): BuildTracker | undefined {
    return this.#tracker;
  }

  exclusive<T>(action: () => Promise<T>): Promise<T> {
    const run = this.#exclusiveTail.then(() => {
      // Checked when the action would start, so actions queued before the stop are refused too (spec section 6).
      this.assertAcceptingCalls();
      // Spec v2a section 4: every command use case is refused while a full or tiled build runs. A preview does
      // not count: World Machine starts previews on its own after edits (fact 42).
      if (this.#tracker?.running) throw new WorldMachineError('REFUSED', BUILD_RUNNING);
      return action();
    });
    this.#exclusiveTail = run.catch(() => undefined);
    return run;
  }

  ensureRunning(): Promise<void> {
    if (this.#state.kind === 'ready') return Promise.resolve();
    this.#starting ??= this.#start().finally(() => {
      this.#starting = undefined;
    });
    return this.#starting;
  }

  async execute(commands: readonly string[]): Promise<readonly RawResponse[]> {
    this.assertAcceptingCalls();
    this.#inFlight++;
    this.#clearIdleTimer();
    try {
      await this.ensureRunning();
      const proc = this.#process;
      const queue = this.#queue;
      if (!queue) throw new WorldMachineError('CRASHED', 'World Machine is not running');
      try {
        return await queue.execute(commands);
      } catch (error) {
        if (error instanceof WorldMachineError && error.code === 'TIMEOUT')
          await this.#markUnhealthy(proc, error.message);
        if (
          error instanceof WorldMachineError &&
          error.code === 'CRASHED' &&
          this.#state.kind === 'unhealthy' &&
          this.#state.reason === LOST_CHANGES
        ) {
          throw new WorldMachineError('CRASHED', LOST_CHANGES);
        }
        throw error;
      }
    } finally {
      this.#inFlight--;
      this.#armIdleTimer();
    }
  }

  async executeOne(command: string): Promise<RawResponse> {
    return requireFrame((await this.execute([command]))[0]);
  }

  /** Records that the open project has unsaved changes (spec section 6). */
  markDirty(): void {
    if (this.#state.kind === 'ready') this.#state = { ...this.#state, dirty: true };
    this.#armIdleTimer();
  }

  /** Records which project is open after an open, a new project, or a save; clears unsaved changes. */
  bind(binding: ProjectBinding): void {
    if (this.#state.kind === 'ready') this.#state = { kind: 'ready', binding, dirty: false };
    this.#armIdleTimer();
  }

  /** Without a budget the long sequence applies: full drain, 10 s grace, 2 s SIGTERM. */
  async shutdown(budget?: ShutdownBudget): Promise<void> {
    this.#shutDown = true;
    this.#clearIdleTimer();
    if (budget)
      this.#startAbort?.abort({ graceMs: budget.graceMs, termMs: budget.termMs } satisfies QuitAbort);
    else this.#startAbort?.abort();
    // A start that is past readiness is in setup: stop its process now instead of waiting for the setup commands.
    if (this.#starting && this.#process) void this.#stop(budget);
    await this.#awaitStartWithin(budget);
    if (this.#state.kind === 'ready' && this.#state.dirty) {
      this.#options.logger.warn('Shutting down with unsaved changes; they are discarded');
    }
    await this.#stop(budget);
  }

  /**
   * A failed setup quits its process with its own fixed budget; a shutdown with a budget must not wait longer
   * than that budget in total. When the wait ends, whatever the start is still quitting is SIGKILLed (spec section 9).
   */
  async #awaitStartWithin(budget: ShutdownBudget | undefined): Promise<void> {
    const starting = this.#starting?.catch(() => undefined);
    if (!starting || !budget) {
      await starting;
      return;
    }
    let timer: NodeJS.Timeout | undefined;
    const expired = new Promise<'expired'>((resolve) => {
      timer = setTimeout(() => resolve('expired'), budget.drainMs + budget.graceMs + budget.termMs);
    });
    try {
      if ((await Promise.race([starting.then(() => 'done' as const), expired])) === 'done') return;
    } finally {
      clearTimeout(timer);
    }
    const procs = new Set(this.#quitting);
    if (this.#spawning) procs.add(this.#spawning);
    await Promise.all([...procs].map((proc) => proc.terminate()));
    await starting;
  }

  /** SIGKILLs every World Machine process this session owns, starting or stopping ones included. */
  async kill(): Promise<void> {
    this.#shutDown = true;
    this.#clearIdleTimer();
    this.#startAbort?.abort(KILL_ABORT);
    const procs = new Set(this.#quitting);
    if (this.#process) procs.add(this.#process);
    if (this.#spawning) procs.add(this.#spawning);
    await Promise.all([...procs].map((proc) => proc.terminate()));
    await this.#starting?.catch(() => undefined);
    await this.#stopping;
  }

  async #start(): Promise<void> {
    const executable = this.#options.executable;
    if (executable === null) {
      throw new WorldMachineError(
        'NOT_CONFIGURED',
        'WORLD_MACHINE_BIN is not set or does not point to an executable file',
      );
    }
    if (this.#shutDown) throw new WorldMachineError('SHUTTING_DOWN', SHUTTING_DOWN_MESSAGE);
    // Spec section 6: a refused or failed reopen fails this start with its reason and the path is forgotten, so the
    // next start opens the default project. Clearing it before the attempt forgets it on every outcome.
    const reopen = this.#reopen;
    this.#reopen = undefined;
    const project =
      reopen === undefined ? await this.#authorizeDefaultProject() : await this.#authorizeReopen(reopen);
    await this.#stopping;
    await this.#process?.terminate();
    if (this.#shutDown) throw new WorldMachineError('SHUTTING_DOWN', SHUTTING_DOWN_MESSAGE);
    this.#reset();
    this.#state = { kind: 'starting' };
    let proc: WorldMachineProcess | undefined;
    const abort = new AbortController();
    this.#startAbort = abort;
    try {
      proc = await this.#options.startProcess(executable, abort.signal, (spawned) => {
        this.#spawning = spawned;
      });
      this.#spawning = undefined;
      const current = proc;
      this.#process = proc;
      proc.onExit(() => this.#onExit(current));
      const tracker = new BuildTracker();
      this.#tracker = tracker;
      proc.onBuildEvent((event) => tracker.apply(event));
      proc.onExit(() => tracker.drop());
      // Spec v2a section 5: the idle timer waits for a running build and restarts when it ends.
      tracker.onEnd(() => this.#armIdleTimer());
      const queue = new CommandQueue(proc, {
        timeoutMs: this.#options.commandTimeoutMs,
        logger: this.#options.logger,
      });
      this.#queue = queue;
      const info = requireFrame((await queue.execute(['system info']))[0]);
      throwIfFailed(info);
      this.#systemInfo = parseSystemInfo(info.output);
      const binding = await this.#bindProject(queue, project);
      this.#state = { kind: 'ready', binding, dirty: false };
      this.#armIdleTimer();
    } catch (error) {
      this.#reset();
      // A shutdown may already be quitting this process; kill() must reach it either way.
      if (proc && !this.#quitting.has(proc)) {
        this.#quitting.add(proc);
        try {
          await proc.quit(2_000);
        } finally {
          this.#quitting.delete(proc);
        }
      }
      if (this.#shutDown && !(error instanceof WorldMachineError && KEEP_DURING_SHUTDOWN.has(error.code))) {
        throw new WorldMachineError('SHUTTING_DOWN', SHUTTING_DOWN_MESSAGE);
      }
      throw error instanceof WorldMachineError
        ? error
        : new WorldMachineError('START_FAILED', `World Machine setup failed: ${String(error)}`);
    } finally {
      this.#startAbort = undefined;
      this.#spawning = undefined;
    }
  }

  async #authorizeDefaultProject(): Promise<string | undefined> {
    const configured = this.#options.defaultProject;
    if (configured === undefined) return undefined;
    try {
      return await this.#options.pathPolicy.authorizeExistingProject(configured);
    } catch (error) {
      if (!(error instanceof WorldMachineError)) throw error;
      throw new WorldMachineError(
        error.code,
        `WORLD_MACHINE_DEFAULT_PROJECT cannot be used: ${error.message}`,
      );
    }
  }

  async #authorizeReopen(path: string): Promise<string> {
    try {
      return await this.#options.pathPolicy.authorizeExistingProject(path);
    } catch (error) {
      if (!(error instanceof WorldMachineError)) throw error;
      throw new WorldMachineError(error.code, `The last open project cannot be reopened: ${error.message}`);
    }
  }

  async #bindProject(queue: CommandQueue, project: string | undefined): Promise<ProjectBinding> {
    if (project !== undefined) {
      const opened = requireFrame((await queue.execute([buildCommand(['project', 'open'], project)]))[0]);
      throwIfFailed(opened);
      // A failed open is a plain line, not an `Error:` line (spec fact 17).
      if (opened.output.includes(OPEN_FAILED)) {
        throw new WorldMachineError(
          'WM_COMMAND_FAILED',
          `World Machine could not open ${project}`,
          OPEN_FAILED,
        );
      }
      requireOpenedLine(opened, project);
      return { kind: 'opened', path: project };
    }
    const created = requireFrame(
      (await queue.execute([buildCommand(['project', 'new', 'default', 'force'])]))[0],
    );
    throwIfFailed(created);
    requireCreatedLine(created);
    return { kind: 'fresh' };
  }

  /**
   * Detaches the current process, drains its queue, and quits it. Stops are chained, so every caller waits for
   * all earlier stops too. `#start` waits for this.
   */
  #stop(budget?: ShutdownBudget): Promise<void> {
    const proc = this.#process;
    if (proc) this.#quitting.add(proc);
    const queue = this.#queue;
    const tracker = this.#tracker;
    this.#reset();
    const previous = this.#stopping;
    const current = (async () => {
      await previous;
      const reason = new WorldMachineError('SHUTTING_DOWN', SHUTTING_DOWN_MESSAGE);
      const drained = queue?.drain(reason);
      await (budget ? withinMs(drained, budget.drainMs) : drained);
      queue?.abort(reason);
      const graceMs = budget?.graceMs ?? DEFAULT_QUIT_GRACE_MS;
      const quitGraceMs = proc && tracker?.running ? await stopBuild(proc, tracker, graceMs) : graceMs;
      await proc?.quit(quitGraceMs, budget?.termMs);
    })();
    this.#stopping = current;
    void current.finally(() => {
      if (proc) this.#quitting.delete(proc);
      if (this.#stopping === current) this.#stopping = undefined;
    });
    return current;
  }

  #onExit(proc: WorldMachineProcess): void {
    if (proc !== this.#process) return;
    this.#clearIdleTimer();
    if (this.#state.kind !== 'unhealthy') {
      const lost = this.#state.kind === 'ready' && this.#state.dirty;
      // Spec section 6: after a clean unexpected exit, the next start reopens an opened project.
      this.#reopen = this.#state.kind === 'ready' && !lost ? openedPath(this.#state.binding) : undefined;
      this.#state = { kind: 'unhealthy', reason: lost ? LOST_CHANGES : 'World Machine exited unexpectedly' };
    }
  }

  async #markUnhealthy(proc: WorldMachineProcess | undefined, reason: string): Promise<void> {
    if (this.#shutDown || proc === undefined || this.#process !== proc) return;
    this.#state = { kind: 'unhealthy', reason };
    this.#clearIdleTimer();
    await proc.terminate();
  }

  #armIdleTimer(): void {
    this.#clearIdleTimer();
    if (this.#options.idleTimeoutMs <= 0 || this.#inFlight > 0 || this.#state.kind !== 'ready') return;
    // Spec v2a section 5: no idle quit while a full or tiled build runs; the tracker re-arms the timer at its end.
    if (this.#tracker?.running) return;
    this.#idleTimer = setTimeout(() => void this.#onIdle(), this.#options.idleTimeoutMs);
    this.#idleTimer.unref();
  }

  #clearIdleTimer(): void {
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    this.#idleTimer = undefined;
  }

  async #onIdle(): Promise<void> {
    const state = this.#state;
    if (state.kind !== 'ready' || this.#inFlight > 0 || this.#tracker?.running) return;
    if (state.dirty) {
      this.#options.logger.warn('Idle timeout reached with unsaved changes; World Machine stays open');
      return;
    }
    this.#options.logger.info('Idle timeout reached; closing World Machine to release the licence seat');
    // Spec section 6: the next start reopens an opened project.
    this.#reopen = openedPath(state.binding);
    await this.#stop();
  }

  #reset(): void {
    this.#clearIdleTimer();
    this.#process = undefined;
    this.#queue = undefined;
    this.#tracker = undefined;
    this.#systemInfo = undefined;
    this.#state = { kind: 'notRunning' };
  }
}

/**
 * Spec v2a section 5: a build racing `project close force` is the likely crash of fact 52, so a running build is
 * stopped first. The wait for its end event takes at most half the grace time; returns the grace left for the quit.
 */
async function stopBuild(proc: WorldMachineProcess, tracker: BuildTracker, graceMs: number): Promise<number> {
  const started = Date.now();
  try {
    proc.write(['build stop']);
    await tracker.ended(Math.floor(graceMs / 2));
  } catch {
    // World Machine exited or stopped reading; the quit that follows handles both.
  }
  return Math.max(graceMs - (Date.now() - started), 0);
}

/** The path of an opened project, or undefined for a fresh one. */
function openedPath(binding: ProjectBinding): string | undefined {
  return binding.kind === 'opened' ? binding.path : undefined;
}

/** Resolves when the promise settles or after `ms`, whichever comes first. */
async function withinMs(promise: Promise<void> | undefined, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  try {
    await Promise.race([promise, expired]);
  } finally {
    clearTimeout(timer);
  }
}
