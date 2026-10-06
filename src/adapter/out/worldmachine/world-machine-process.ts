import { type ChildProcess, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { BuildEvent } from '../../../domain/build.js';
import { WorldMachineError } from '../../../domain/errors.js';
import type { Logger } from '../../../logger.js';
import { parseBuildEvent } from './build-events.js';
import type { CommandChannel } from './channel.js';
import { isLicenceText, parseLogLine } from './log-lines.js';

export const READY_LINE = 'Startup: Completed. Transferring control into event loop.';
/** Abort reason that makes a pending start SIGKILL World Machine instead of quitting it politely. */
export const KILL_ABORT = 'kill';
/** The grace `quit` waits for World Machine to exit after `system quit force`, unless the caller passes one. */
export const DEFAULT_QUIT_GRACE_MS = 10_000;

/** Abort reason that makes a pending start quit World Machine within the caller's shutdown budget. */
export type QuitAbort = { readonly graceMs: number; readonly termMs: number };
/** How long the ready line may lag the session check before World Machine counts as waiting on its recovery dialog. */
export const RECOVERY_DIALOG_MS = 5_000;
/** How long a start may wait on the recovery dialog before World Machine is closed. */
export const RECOVERY_DIALOG_BOUND_MS = 600_000;
/** The grace a start that never became ready gives `system quit force` before World Machine is killed. */
const START_QUIT_GRACE_MS = 2_000;
const SESSION_CHECK = 'Checking for session and autosave files';
const RECENT_LINES = 10;
const DISPLAY_ERROR = /could not connect to display/i;
const DISPLAY_HINT =
  ' World Machine could not open its window. Pass DISPLAY, WAYLAND_DISPLAY, XAUTHORITY, and XDG_RUNTIME_DIR in the MCP server environment (see README).';
const LICENCE_CHECKOUT_FAILED = 'License Manager.Checkout: License checkout failed';
const NO_LICENCE_MESSAGE =
  'World Machine has no valid licence on this machine. Start World Machine once outside the MCP and activate it, then retry.';
// The logger drops every line that mentions a licence (spec section 8), so the logged copy avoids the word.
const NO_LICENCE_LOG =
  'World Machine is not activated on this machine. Start World Machine once outside the MCP and activate it, then retry.';
// 'close' waits for stdout to drain; this bounds the wait if a grandchild keeps the pipe open.
const STDIO_DRAIN_MS = 1_000;

export type ProcessOptions = {
  readonly bin: string;
  readonly readyTimeoutMs: number;
  readonly logger: Logger;
  readonly env?: NodeJS.ProcessEnv;
  readonly signal?: AbortSignal;
  /** Replaces `node:child_process` spawn, so a test can make the launch itself fail. */
  readonly spawn?: typeof spawn;
  /** Called synchronously once the process exists, before it is ready, so a caller can stop it while it starts. */
  readonly onSpawn?: (proc: WorldMachineProcess) => void;
  /** Defaults to RECOVERY_DIALOG_MS; tests shorten it. */
  readonly recoveryDialogMs?: number;
  /** Defaults to RECOVERY_DIALOG_BOUND_MS; tests shorten it. */
  readonly recoveryDialogBoundMs?: number;
};

export class WorldMachineProcess implements CommandChannel {
  readonly #child: ChildProcess;
  readonly #logger: Logger;
  readonly #lineListeners: ((line: string) => void)[] = [];
  readonly #buildListeners: ((event: BuildEvent) => void)[] = [];
  readonly #exitListeners: (() => void)[] = [];
  readonly #recoveryDialogListeners: (() => void)[] = [];
  readonly #recent: string[] = [];
  readonly #exitPromise: Promise<void>;
  #readyListener: (() => void) | undefined;
  #noLicenceListener: (() => void) | undefined;
  #sessionCheckListener: (() => void) | undefined;
  #exited = false;
  /** 'exit' observed; `exited` waits for 'close' so the last output lines are delivered first. */
  #exitSeen = false;
  #resolveExit: () => void = () => undefined;

  private constructor(child: ChildProcess, logger: Logger) {
    this.#child = child;
    this.#logger = logger;
    this.#exitPromise = new Promise((resolve) => {
      this.#resolveExit = resolve;
      child.once('close', (code, signal) => this.#finish(code, signal));
      child.once('exit', (code, signal) => {
        this.#exitSeen = true;
        setTimeout(() => this.#finish(code, signal), STDIO_DRAIN_MS).unref();
      });
    });
    child.stdin?.on('error', (error) => logger.debug(`World Machine stdin error: ${error.message}`));
    if (child.stdout) createInterface({ input: child.stdout }).on('line', (line) => this.#onLine(line));
  }

  /** Spawns World Machine with stdout and stderr merged at the fd level (spec section 5.1). */
  static start(options: ProcessOptions): Promise<WorldMachineProcess> {
    let child: ChildProcess;
    try {
      child = (options.spawn ?? spawn)('/bin/sh', ['-c', 'exec "$0" --cli 2>&1', options.bin], {
        stdio: ['pipe', 'pipe', 'ignore'],
        env: options.env ?? process.env,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return Promise.reject(
        new WorldMachineError('START_FAILED', `Could not start World Machine: ${reason}`),
      );
    }
    const proc = new WorldMachineProcess(child, options.logger);
    options.onSpawn?.(proc);
    return new Promise((resolve, reject) => {
      let settled = false;
      let dialogTimer: NodeJS.Timeout | undefined;
      const settle = () => {
        settled = true;
        clearTimeout(timer);
        clearTimeout(dialogTimer);
        options.signal?.removeEventListener('abort', onAbort);
      };
      const fail = (
        message: string,
        stop: () => Promise<void> = () => proc.terminate(),
        withDetail = true,
      ) => {
        if (settled) return;
        settle();
        const detail = withDetail ? proc.#startupDiagnostics() : undefined;
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
      // A start that is merely slow is quit, not killed: every unclean exit queues one more crashed session (fact 73).
      const timeOut = (ms: number) =>
        fail(`World Machine did not become ready within ${ms} ms`, () => proc.quit(START_QUIT_GRACE_MS, 0));
      let timer = setTimeout(() => timeOut(options.readyTimeoutMs), options.readyTimeoutMs);
      // Fact 73: after the session check, World Machine prints nothing while its recovery dialog waits for the user.
      // The readiness limit gives way to the dialog's bound, and World Machine is left running for the user to answer.
      proc.#sessionCheckListener = () => {
        if (settled || dialogTimer !== undefined) return;
        dialogTimer = setTimeout(() => {
          if (settled) return;
          clearTimeout(timer);
          const boundMs = options.recoveryDialogBoundMs ?? RECOVERY_DIALOG_BOUND_MS;
          timer = setTimeout(() => timeOut(boundMs), boundMs);
          for (const listener of proc.#recoveryDialogListeners) listener();
        }, options.recoveryDialogMs ?? RECOVERY_DIALOG_MS);
      };
      // Without a pid nothing was launched, so there is no process to wait for.
      child.on('error', (error) => {
        if (settled) {
          // A second 'error' (or one after start) must not become an uncaught exception.
          options.logger.debug(`World Machine process error after startup settled: ${error.message}`);
          return;
        }
        fail(`Could not start World Machine: ${error.message}`, () =>
          child.pid === undefined ? proc.#abandon() : proc.terminate(),
        );
      });
      proc.#exitListeners.push(() => fail('World Machine exited during startup'));
      proc.#noLicenceListener = () => {
        if (settled) return;
        options.logger.error(NO_LICENCE_LOG);
        fail(NO_LICENCE_MESSAGE, undefined, false);
      };
      proc.#readyListener = () => {
        if (settled) return;
        settle();
        proc.#readyListener = undefined;
        proc.#noLicenceListener = undefined;
        proc.#sessionCheckListener = undefined;
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

  /** Called when a start waits on World Machine's 'Recover crashed session' dialog (fact 73); the start goes on. */
  onRecoveryDialog(listener: () => void): void {
    this.#recoveryDialogListeners.push(listener);
  }

  /**
   * Build events (spec v2a section 5). They arrive unsolicited, also inside another command's frame (fact 47), and
   * never reach line listeners, so no command frame contains one.
   */
  onBuildEvent(listener: (event: BuildEvent) => void): void {
    this.#buildListeners.push(listener);
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
    if (this.#exited || this.#exitSeen || !this.#child.stdin)
      throw new WorldMachineError('CRASHED', 'World Machine is not running');
    this.#child.stdin.write(lines.map((line) => `${line}\n`).join(''));
  }

  /**
   * `project close force` and `system quit force`, then SIGTERM, then SIGKILL (spec section 9). `termMs` 0 skips SIGTERM. Resolves once
   * the process is gone.
   */
  async quit(graceMs = DEFAULT_QUIT_GRACE_MS, termMs = 2_000): Promise<void> {
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

  #finish(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.#exited) return;
    this.#exited = true;
    this.#exitSeen = true;
    this.#logger.debug(`World Machine exited (code ${code}, signal ${signal})`);
    for (const listener of this.#exitListeners) listener();
    this.#resolveExit();
  }

  /** Marks a process that never launched as gone, so `exited` and `write()` agree with reality. */
  #abandon(): Promise<void> {
    this.#finish(null, null);
    return Promise.resolve();
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

  /** Only recent lines known to help the client; everything else stays in the debug log (spec section 8). */
  #startupDiagnostics(): string | undefined {
    return this.#recent.filter((line) => DISPLAY_ERROR.test(line)).join('\n') || undefined;
  }

  #onLine(line: string): void {
    const event = parseBuildEvent(line);
    if (event !== undefined) {
      this.#logger.debug(`World Machine build event: ${line}`);
      for (const listener of this.#buildListeners) listener(event);
      return;
    }
    const log = parseLogLine(line);
    if (log) {
      if (log.text.includes(LICENCE_CHECKOUT_FAILED)) this.#noLicenceListener?.();
      this.#logger.worldMachine(log.level, log.text);
      if (log.text.includes(SESSION_CHECK)) this.#sessionCheckListener?.();
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
