import type { PathPolicyPort } from '../../../application/port/out/path-policy-port.js';
import type {
  SessionStatus,
  WorldMachineSessionPort,
} from '../../../application/port/out/world-machine-session-port.js';
import { WorldMachineError } from '../../../domain/errors.js';
import { type ProjectBinding, type SessionState, summarize } from '../../../domain/session.js';
import type { SystemInfo } from '../../../domain/system-info.js';
import type { Logger } from '../../../logger.js';
import { buildCommand } from './command-builder.js';
import { CommandQueue } from './command-queue.js';
import { parseSystemInfo } from './parsers/system-info.js';
import { type RawResponse, requireFrame, throwIfFailed } from './raw-response.js';
import type { WorldMachineProcess } from './world-machine-process.js';

export type SessionOptions = {
  readonly executable: string | null;
  readonly defaultProject: string | undefined;
  readonly pathPolicy: PathPolicyPort;
  readonly commandTimeoutMs: number;
  readonly idleTimeoutMs: number;
  readonly logger: Logger;
  readonly startProcess: (executable: string, signal: AbortSignal) => Promise<WorldMachineProcess>;
};

const OPEN_FAILED = 'Failed to open project.';

export class WorldMachineSession implements WorldMachineSessionPort {
  readonly #options: SessionOptions;
  #state: SessionState = { kind: 'notRunning' };
  #starting: Promise<void> | undefined;
  #startAbort: AbortController | undefined;
  #stopping: Promise<void> | undefined;
  #process: WorldMachineProcess | undefined;
  #queue: CommandQueue | undefined;
  #systemInfo: SystemInfo | undefined;
  #idleTimer: NodeJS.Timeout | undefined;
  #inFlight = 0;
  #shutDown = false;

  constructor(options: SessionOptions) {
    this.#options = options;
  }

  status(): SessionStatus {
    return {
      executable: this.#options.executable,
      session: summarize(this.#state),
      ...(this.#systemInfo ? { systemInfo: this.#systemInfo } : {}),
    };
  }

  ensureRunning(): Promise<void> {
    if (this.#state.kind === 'ready') return Promise.resolve();
    this.#starting ??= this.#start().finally(() => {
      this.#starting = undefined;
    });
    return this.#starting;
  }

  async execute(commands: readonly string[]): Promise<readonly RawResponse[]> {
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

  async shutdown(): Promise<void> {
    this.#shutDown = true;
    this.#clearIdleTimer();
    this.#startAbort?.abort();
    await this.#starting?.catch(() => undefined);
    if (this.#state.kind === 'ready' && this.#state.dirty) {
      this.#options.logger.warn('Shutting down with unsaved changes; they are discarded');
    }
    await this.#stop();
  }

  async #start(): Promise<void> {
    const executable = this.#options.executable;
    if (executable === null) {
      throw new WorldMachineError(
        'NOT_CONFIGURED',
        'WORLD_MACHINE_BIN is not set or does not point to an executable file',
      );
    }
    if (this.#shutDown) throw new WorldMachineError('START_FAILED', 'The server is shutting down');
    const defaultProject = await this.#authorizeDefaultProject();
    await this.#stopping;
    await this.#process?.terminate();
    if (this.#shutDown) throw new WorldMachineError('START_FAILED', 'The server is shutting down');
    this.#reset();
    this.#state = { kind: 'starting' };
    let proc: WorldMachineProcess | undefined;
    const abort = new AbortController();
    this.#startAbort = abort;
    try {
      proc = await this.#options.startProcess(executable, abort.signal);
      const current = proc;
      this.#process = proc;
      proc.onExit(() => this.#onExit(current));
      const queue = new CommandQueue(proc, { timeoutMs: this.#options.commandTimeoutMs });
      this.#queue = queue;
      const info = requireFrame((await queue.execute(['system info']))[0]);
      throwIfFailed(info);
      this.#systemInfo = parseSystemInfo(info.output);
      const binding = await this.#bindProject(queue, defaultProject);
      this.#state = { kind: 'ready', binding, dirty: false };
      this.#armIdleTimer();
    } catch (error) {
      this.#reset();
      await proc?.quit(2_000);
      throw error instanceof WorldMachineError
        ? error
        : new WorldMachineError('START_FAILED', `World Machine setup failed: ${String(error)}`);
    } finally {
      this.#startAbort = undefined;
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

  async #bindProject(queue: CommandQueue, defaultProject: string | undefined): Promise<ProjectBinding> {
    if (defaultProject !== undefined) {
      const opened = requireFrame(
        (await queue.execute([buildCommand(['project', 'open'], defaultProject)]))[0],
      );
      throwIfFailed(opened);
      // A failed open is a plain line, not an `Error:` line (spec fact 17).
      if (opened.output.includes(OPEN_FAILED)) {
        throw new WorldMachineError(
          'WM_COMMAND_FAILED',
          `World Machine could not open ${defaultProject}`,
          OPEN_FAILED,
        );
      }
      return { kind: 'opened', path: defaultProject };
    }
    throwIfFailed(
      requireFrame((await queue.execute([buildCommand(['project', 'new', 'default', 'force'])]))[0]),
    );
    return { kind: 'fresh' };
  }

  /**
   * Detaches the current process, drains its queue, and quits it. Stops are chained, so every caller waits for
   * all earlier stops too. `#start` waits for this.
   */
  #stop(): Promise<void> {
    const proc = this.#process;
    const queue = this.#queue;
    this.#reset();
    const previous = this.#stopping;
    const current = (async () => {
      await previous;
      await queue?.drain(new WorldMachineError('CRASHED', 'World Machine is shutting down'));
      await proc?.quit();
    })();
    this.#stopping = current;
    void current.finally(() => {
      if (this.#stopping === current) this.#stopping = undefined;
    });
    return current;
  }

  #onExit(proc: WorldMachineProcess): void {
    if (proc !== this.#process) return;
    this.#clearIdleTimer();
    if (this.#state.kind !== 'unhealthy') {
      this.#state = { kind: 'unhealthy', reason: 'World Machine exited unexpectedly' };
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
    this.#idleTimer = setTimeout(() => void this.#onIdle(), this.#options.idleTimeoutMs);
    this.#idleTimer.unref();
  }

  #clearIdleTimer(): void {
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    this.#idleTimer = undefined;
  }

  async #onIdle(): Promise<void> {
    if (this.#state.kind !== 'ready' || this.#inFlight > 0) return;
    if (this.#state.dirty) {
      this.#options.logger.warn('Idle timeout reached with unsaved changes; World Machine stays open');
      return;
    }
    this.#options.logger.info('Idle timeout reached; closing World Machine to release the licence seat');
    await this.#stop();
  }

  #reset(): void {
    this.#clearIdleTimer();
    this.#process = undefined;
    this.#queue = undefined;
    this.#systemInfo = undefined;
    this.#state = { kind: 'notRunning' };
  }
}
