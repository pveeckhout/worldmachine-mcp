import { type ChildProcess, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { WorldMachineError } from '../../../domain/errors.js';
import type { Logger } from '../../../logger.js';
import type { CommandChannel } from './channel.js';
import { isLicenceText, parseLogLine } from './log-lines.js';

export const READY_LINE = 'Startup: Completed. Transferring control into event loop.';
/** Abort reason that makes a pending start SIGKILL World Machine instead of quitting it politely. */
export const KILL_ABORT = 'kill';
/** Abort reason that makes a pending start quit World Machine within the caller's shutdown budget. */
export type QuitAbort = { readonly graceMs: number; readonly termMs: number };
const RECENT_LINES = 10;
const DISPLAY_ERROR = /could not connect to display/i;
const DISPLAY_HINT =
  ' World Machine could not open its window. Pass DISPLAY, WAYLAND_DISPLAY, XAUTHORITY, and XDG_RUNTIME_DIR in the MCP server environment (see README).';
// 'close' waits for stdout to drain; this bounds the wait if a grandchild keeps the pipe open.
const STDIO_DRAIN_MS = 1_000;

export type ProcessOptions = {
  readonly bin: string;
  readonly readyTimeoutMs: number;
  readonly logger: Logger;
  readonly env?: NodeJS.ProcessEnv;
  readonly signal?: AbortSignal;
  /** Called synchronously once the process exists, before it is ready, so a caller can stop it while it starts. */
  readonly onSpawn?: (proc: WorldMachineProcess) => void;
};

export class WorldMachineProcess implements CommandChannel {
  readonly #child: ChildProcess;
  readonly #logger: Logger;
  readonly #lineListeners: ((line: string) => void)[] = [];
  readonly #exitListeners: (() => void)[] = [];
  readonly #recent: string[] = [];
  readonly #exitPromise: Promise<void>;
  #readyListener: (() => void) | undefined;
  #exited = false;

  private constructor(child: ChildProcess, logger: Logger) {
    this.#child = child;
    this.#logger = logger;
    this.#exitPromise = new Promise((resolve) => {
      const finish = (code: number | null, signal: NodeJS.Signals | null) => {
        if (this.#exited) return;
        this.#exited = true;
        logger.debug(`World Machine exited (code ${code}, signal ${signal})`);
        for (const listener of this.#exitListeners) listener();
        resolve();
      };
      child.once('close', finish);
      child.once('exit', (code, signal) => {
        setTimeout(() => finish(code, signal), STDIO_DRAIN_MS).unref();
      });
    });
    child.stdin?.on('error', (error) => logger.debug(`World Machine stdin error: ${error.message}`));
    if (child.stdout) createInterface({ input: child.stdout }).on('line', (line) => this.#onLine(line));
  }

  /** Spawns World Machine with stdout and stderr merged at the fd level (spec section 5.1). */
  static start(options: ProcessOptions): Promise<WorldMachineProcess> {
    const child = spawn('/bin/sh', ['-c', 'exec "$0" --cli 2>&1', options.bin], {
      stdio: ['pipe', 'pipe', 'ignore'],
      env: options.env ?? process.env,
    });
    const proc = new WorldMachineProcess(child, options.logger);
    options.onSpawn?.(proc);
    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = () => {
        settled = true;
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
      };
      const fail = (message: string, stop: () => Promise<void> = () => proc.terminate()) => {
        if (settled) return;
        settle();
        const detail = proc.#recent.join('\n') || undefined;
        const fullMessage =
          detail !== undefined && DISPLAY_ERROR.test(detail) ? message + DISPLAY_HINT : message;
        void stop().then(() => reject(new WorldMachineError('START_FAILED', fullMessage, detail)));
      };
      const onAbort = () =>
        fail('World Machine start was cancelled', () => {
          const reason: unknown = options.signal?.reason;
          if (reason === KILL_ABORT) return proc.terminate();
          if (isQuitAbort(reason)) return proc.quit(reason.graceMs, reason.termMs);
          return proc.quit(5_000);
        });
      const timer = setTimeout(
        () => fail(`World Machine did not become ready within ${options.readyTimeoutMs} ms`),
        options.readyTimeoutMs,
      );
      child.once('error', (error) => fail(`Could not start World Machine: ${error.message}`));
      proc.#exitListeners.push(() => fail('World Machine exited during startup'));
      proc.#readyListener = () => {
        if (settled) return;
        settle();
        proc.#readyListener = undefined;
        resolve(proc);
      };
      if (options.signal?.aborted) onAbort();
      else options.signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  get exited(): boolean {
    return this.#exited;
  }

  onLine(listener: (line: string) => void): void {
    this.#lineListeners.push(listener);
  }

  /** A listener added after the exit still fires, asynchronously so callers can finish their own setup first. */
  onExit(listener: () => void): void {
    if (this.#exited) {
      queueMicrotask(listener);
      return;
    }
    this.#exitListeners.push(listener);
  }

  write(lines: readonly string[]): void {
    if (this.#exited || !this.#child.stdin)
      throw new WorldMachineError('CRASHED', 'World Machine is not running');
    this.#child.stdin.write(lines.map((line) => `${line}\n`).join(''));
  }

  /**
   * `project close force` and `system quit force`, then SIGTERM, then SIGKILL (spec section 9). `termMs` 0 skips SIGTERM. Resolves once
   * the process is gone.
   */
  async quit(graceMs = 10_000, termMs = 2_000): Promise<void> {
    if (this.#exited) return;
    // Spec facts 19-20: a modified project turns `system quit force` into a modal dialog and a killed World
    // Machine keeps its licence seat, so close the project first, as its own write (spec section 9).
    // Facts 14-15: World Machine reads one new line per read, so nudge until both have been read.
    this.#child.stdin?.write('project close force\n');
    this.#child.stdin?.write('system quit force\n');
    const nudge = setInterval(() => {
      if (!this.#exited) this.#child.stdin?.write('\n');
    }, 100);
    try {
      if (await this.#exitedWithin(graceMs)) return;
      if (termMs > 0) {
        this.#child.kill('SIGTERM');
        if (await this.#exitedWithin(termMs)) return;
      }
      await this.terminate();
    } finally {
      clearInterval(nudge);
    }
  }

  /** SIGKILL, resolving once the process is gone. */
  async terminate(): Promise<void> {
    if (!this.#exited) this.#child.kill('SIGKILL');
    await this.#exitPromise;
  }

  #exitedWithin(ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), ms);
      void this.#exitPromise.then(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  #onLine(line: string): void {
    const log = parseLogLine(line);
    if (log) {
      this.#logger.worldMachine(log.level, log.text);
      if (log.text.includes(READY_LINE)) this.#readyListener?.();
      return;
    }
    // Startup diagnostics may reach a tool result, so they never include log or licence lines.
    if (!isLicenceText(line)) {
      this.#recent.push(line);
      if (this.#recent.length > RECENT_LINES) this.#recent.shift();
    }
    for (const listener of this.#lineListeners) listener(line);
  }
}

function isQuitAbort(reason: unknown): reason is QuitAbort {
  return (
    typeof reason === 'object' &&
    reason !== null &&
    typeof (reason as QuitAbort).graceMs === 'number' &&
    typeof (reason as QuitAbort).termMs === 'number'
  );
}
