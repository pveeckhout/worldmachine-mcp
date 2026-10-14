import type { ChildProcess, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { copyFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { CommandQueue } from '../../../../src/adapter/out/worldmachine/command-queue.js';
import {
  KILL_ABORT,
  READY_LINE,
  WorldMachineProcess,
} from '../../../../src/adapter/out/worldmachine/world-machine-process.js';
import { WorldMachineError } from '../../../../src/domain/errors.js';
import { captureLogger, FAKE_WM, fakeEnv, isAlive, recorder, waitUntil } from '../../../support/fake-wm.js';

const NO_LICENCE =
  'World Machine has no valid licence on this machine. Start World Machine once outside the MCP and activate it, then retry.';

// The logger drops lines that mention a licence, so the logged copy avoids the word.
const NO_LICENCE_LOG =
  'World Machine is not activated on this machine. Start World Machine once outside the MCP and activate it, then retry.';

const started: WorldMachineProcess[] = [];
afterEach(async () => {
  await Promise.all(started.splice(0).map((proc) => proc.terminate()));
});

// The repaired-activation line the server logs; it avoids the licence word for the same reason.
const REPAIRED_LOG = 'World Machine repaired its activation during startup.';

async function start(extra: Record<string, string> = {}, bin = FAKE_WM, readyTimeoutMs = 5_000) {
  const logger = captureLogger();
  const proc = await WorldMachineProcess.start({ bin, readyTimeoutMs, logger, env: fakeEnv(extra) });
  started.push(proc);
  return { proc, logger };
}

async function startFailure(extra: Record<string, string>, bin = FAKE_WM, readyTimeoutMs = 5_000) {
  try {
    await start(extra, bin, readyTimeoutMs);
  } catch (error) {
    return error as WorldMachineError;
  }
  throw new Error('expected start to fail');
}

describe('WorldMachineProcess', () => {
  it('resolves once ready and routes log lines to the logger, not to line listeners', async () => {
    const { proc, logger } = await start();
    const lines: string[] = [];
    proc.onLine((line) => lines.push(line));
    proc.write(['system info']);
    await waitUntil(() => lines.some((line) => line.includes('Build 4067')));
    expect(lines.some((line) => line.startsWith('['))).toBe(false);
    expect(logger.lines).toContain('wm-info: Startup: Completed. Transferring control into event loop.');
  });

  it('receives error lines from stderr on the same stream', async () => {
    const { proc } = await start();
    const lines: string[] = [];
    proc.onLine((line) => lines.push(line));
    proc.write(['bogus']);
    await waitUntil(() => lines.some((line) => line.startsWith("Error: Unknown command: 'bogus'")));
  });

  it('quits with system quit force and reports exited once', async () => {
    const record = recorder();
    const { proc } = await start({ FAKE_WM_RECORD: record.path });
    let exitEvents = 0;
    proc.onExit(() => exitEvents++);
    await proc.quit();
    expect(proc.exited).toBe(true);
    expect(exitEvents).toBe(1);
    expect(record.lines()).toEqual(['START', 'project close force', 'system quit force', 'EXIT']);
  });

  it('fires an exit listener registered after the process exited, asynchronously', async () => {
    const { proc } = await start();
    await proc.quit();
    let calls = 0;
    proc.onExit(() => calls++);
    expect(calls).toBe(0);
    await waitUntil(() => calls === 1);
    await new Promise((resolve) => setImmediate(resolve));
    expect(calls).toBe(1);
  });

  it('delivers every output line before exit listeners run', async () => {
    const { proc } = await start();
    const events: string[] = [];
    proc.onLine((line) => events.push(line));
    proc.onExit(() => events.push('<exit>'));
    await proc.quit();
    expect(events.at(-1)).toBe('<exit>');
    expect(events).toContain('Exiting World Machine...');
  });

  it('launches an executable whose path contains spaces', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'wm ')), 'with space');
    mkdirSync(dir);
    const bin = join(dir, 'fake wm.mjs');
    copyFileSync(FAKE_WM, bin);
    const { proc } = await start({}, bin);
    expect(proc.exited).toBe(false);
  });

  it('fails with START_FAILED when the shell cannot execute the binary', async () => {
    const error = await startFailure({}, '/nonexistent/world-machine');
    expect(error.code).toBe('START_FAILED');
  });

  it('fails with START_FAILED when World Machine exits before ready, without passing unknown lines on', async () => {
    const error = await startFailure({ FAKE_WM_STARTUP: 'exit' });
    expect(error.code).toBe('START_FAILED');
    expect(error.worldMachineMessage).toBeUndefined();
  });

  it('fails with a fixed message and no detail when World Machine has no licence', async () => {
    const record = recorder();
    const began = Date.now();
    const error = await startFailure({ FAKE_WM_UNLICENSED: '1', FAKE_WM_RECORD: record.path }, FAKE_WM, 300);
    expect(error.code).toBe('START_FAILED');
    expect(error.message).toBe(NO_LICENCE);
    expect(error.worldMachineMessage).toBeUndefined();
    expect(Date.now() - began).toBeLessThan(4_000);
    await waitUntil(() => record.pids().length > 0 && !record.pids().some(isAlive), 3_000);
  });

  it('logs a licence-free copy of the no-licence sentence once at error level', async () => {
    const logger = captureLogger();
    await expect(
      WorldMachineProcess.start({
        bin: FAKE_WM,
        readyTimeoutMs: 300,
        logger,
        env: fakeEnv({ FAKE_WM_UNLICENSED: '1' }),
      }),
    ).rejects.toThrow(NO_LICENCE);
    expect(logger.lines.filter((line) => line.startsWith('error:'))).toHaveLength(1);
    expect(logger.lines.filter((line) => line === `error: ${NO_LICENCE_LOG}`)).toHaveLength(1);
  });

  describe('when the licence checkout fails (live 2026-10-14: World Machine repairs its activation itself)', () => {
    it('starts once World Machine has repaired it, and logs that once without a licence word', async () => {
      const { proc, logger } = await start({ FAKE_WM_LICENCE_REPAIR: '500' });
      expect(proc.exited).toBe(false);
      expect(logger.lines.filter((line) => line === `info: ${REPAIRED_LOG}`)).toHaveLength(1);
      // World Machine's own lines (wm-) go through the logger's licence filter; the server's lines need none.
      const own = logger.lines.filter((line) => !line.startsWith('wm-'));
      expect(own.filter((line) => /licen[cs]e/i.test(line))).toEqual([]);
      expect(own.filter((line) => line.startsWith('error:'))).toEqual([]);
    });

    it('fails with the no-licence message at the readiness deadline, not at the failed checkout', async () => {
      const record = recorder();
      const logger = captureLogger();
      const began = Date.now();
      const starting = WorldMachineProcess.start({
        bin: FAKE_WM,
        readyTimeoutMs: 600,
        logger,
        env: fakeEnv({ FAKE_WM_UNLICENSED: '1', FAKE_WM_RECORD: record.path }),
        onSpawn: (proc) => started.push(proc),
      });
      let outcome: WorldMachineError | undefined;
      const failed = starting.then(
        () => {
          throw new Error('expected start to fail');
        },
        (error: WorldMachineError) => {
          outcome = error;
        },
      );
      await waitUntil(() => logger.lines.some((line) => line.includes('License checkout failed')), 3_000);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(outcome).toBeUndefined();
      expect(record.pids().every(isAlive)).toBe(true);
      await failed;
      // Timers may fire a millisecond early; the margin still rules out a failure at the checkout line.
      expect(Date.now() - began).toBeGreaterThanOrEqual(590);
      expect(outcome?.code).toBe('START_FAILED');
      expect(outcome?.message).toBe(NO_LICENCE);
      expect(outcome?.worldMachineMessage).toBeUndefined();
      expect(logger.lines.filter((line) => line.startsWith('error:'))).toEqual([`error: ${NO_LICENCE_LOG}`]);
      await waitUntil(() => record.pids().length > 0 && !record.pids().some(isAlive), 3_000);
    });

    it('fails at once with the no-licence message when the user quits the activation dialog', async () => {
      const logger = captureLogger();
      const began = Date.now();
      await expect(
        WorldMachineProcess.start({
          bin: FAKE_WM,
          readyTimeoutMs: 5_000,
          logger,
          env: fakeEnv({ FAKE_WM_UNLICENSED: 'quit' }),
        }),
      ).rejects.toMatchObject({ code: 'START_FAILED', message: NO_LICENCE, worldMachineMessage: undefined });
      expect(Date.now() - began).toBeLessThan(3_000);
      expect(logger.lines.filter((line) => line.startsWith('error:'))).toEqual([`error: ${NO_LICENCE_LOG}`]);
    });
  });

  it('keeps unknown plain startup lines out of a readiness-timeout detail', async () => {
    const error = await startFailure(
      { FAKE_WM_STARTUP: 'silent', FAKE_WM_STARTUP_OUT: 'Wrong host (-193): _check_rehost()' },
      FAKE_WM,
      300,
    );
    expect(error.code).toBe('START_FAILED');
    expect(error.message).toContain('300 ms');
    expect(error.worldMachineMessage).toBeUndefined();
  });

  it('keeps a display error in a readiness-timeout detail, with the hint', async () => {
    const error = await startFailure(
      {
        FAKE_WM_STARTUP: 'silent',
        FAKE_WM_STARTUP_OUT: 'something odd\nqt.qpa.xcb: could not connect to display ',
      },
      FAKE_WM,
      300,
    );
    expect(error.worldMachineMessage).toBe('qt.qpa.xcb: could not connect to display ');
    expect(error.message).toContain('DISPLAY, WAYLAND_DISPLAY');
  });

  it('keeps a plain licence line out of the START_FAILED message and detail', async () => {
    const error = await startFailure({ FAKE_WM_STARTUP: 'licence' });
    expect(error.code).toBe('START_FAILED');
    expect(error.worldMachineMessage).toBeUndefined();
    expect(error.message).not.toMatch(/licen[cs]e/i);
  });

  it('adds a display hint when World Machine cannot open its window', async () => {
    const error = await startFailure({ FAKE_WM_STARTUP: 'display' });
    expect(error.code).toBe('START_FAILED');
    expect(error.message).toContain('DISPLAY, WAYLAND_DISPLAY, XAUTHORITY, and XDG_RUNTIME_DIR');
    expect(error.worldMachineMessage).toContain('could not connect to display');
  });

  it('does not add the display hint to other startup failures', async () => {
    const error = await startFailure({ FAKE_WM_STARTUP: 'exit' });
    expect(error.message).not.toContain('DISPLAY');
  });

  it('fails with START_FAILED when World Machine never becomes ready, after the process is gone', async () => {
    const record = recorder();
    const error = await startFailure(
      { FAKE_WM_STARTUP: 'silent', FAKE_WM_RECORD: record.path },
      FAKE_WM,
      300,
    );
    expect(error.code).toBe('START_FAILED');
    expect(error.message).toContain('300 ms');
  });

  it('tries system quit force before ending a start that timed out', async () => {
    const record = recorder();
    const error = await startFailure(
      { FAKE_WM_STARTUP: 'silent', FAKE_WM_RECORD: record.path },
      FAKE_WM,
      300,
    );
    expect(error.message).toBe('World Machine did not become ready within 300 ms');
    const lines = record.lines();
    expect(lines.indexOf('project close force')).toBeGreaterThan(0);
    expect(lines.indexOf('system quit force')).toBeGreaterThan(lines.indexOf('project close force'));
    expect(record.pids().some(isAlive)).toBe(false);
  });

  describe("with the 'Recover crashed session' dialog", () => {
    function dialogStart(
      extra: Record<string, string>,
      bounds: { recoveryDialogMs?: number; recoveryDialogBoundMs?: number } = {},
    ) {
      const record = recorder();
      const dialogs: number[] = [];
      const began = Date.now();
      const starting = WorldMachineProcess.start({
        bin: FAKE_WM,
        readyTimeoutMs: 1_000,
        recoveryDialogMs: 300,
        ...bounds,
        logger: captureLogger(),
        env: fakeEnv({ FAKE_WM_RECORD: record.path, ...extra }),
        onSpawn: (proc) => {
          started.push(proc);
          proc.onRecoveryDialog(() => dialogs.push(Date.now() - began));
        },
      });
      return { starting, record, dialogs };
    }

    it('reports the dialog after the session check, without ending World Machine or the start', async () => {
      const { starting, record, dialogs } = dialogStart({ FAKE_WM_RECOVERY_DIALOG: '2000' });
      await waitUntil(() => dialogs.length > 0, 3_000);
      expect(dialogs).toHaveLength(1);
      expect(record.pids().every(isAlive)).toBe(true);
      // Past the 1 s readiness limit, which no longer applies once the dialog is open.
      const proc = await starting;
      expect(proc.exited).toBe(false);
      expect(proc.recoveredSession).toBe(true);
      expect(dialogs).toHaveLength(1);
    });

    it('starts without reporting a dialog when the ready line follows the session check in time', async () => {
      const { starting, dialogs } = dialogStart({ FAKE_WM_RECOVERY_DIALOG: '0' });
      const proc = await starting;
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(dialogs).toEqual([]);
      expect(proc.recoveredSession).toBe(true);
    });

    it('reports no recovered session after a start without one', async () => {
      const { proc } = await start();
      expect(proc.recoveredSession).toBe(false);
    });

    it('ends World Machine with START_FAILED when the dialog stays open past its bound', async () => {
      const { starting, record, dialogs } = dialogStart(
        { FAKE_WM_RECOVERY_DIALOG: 'never' },
        { recoveryDialogBoundMs: 1_500 },
      );
      await expect(starting).rejects.toMatchObject({
        code: 'START_FAILED',
        message: 'World Machine did not become ready within 1500 ms',
      });
      expect(dialogs).toHaveLength(1);
      expect(record.pids().some(isAlive)).toBe(false);
    });

    it('quits a start that waits on the dialog within the abort reason budget', async () => {
      const controller = new AbortController();
      const record = recorder();
      const dialogs: number[] = [];
      const starting = WorldMachineProcess.start({
        bin: FAKE_WM,
        readyTimeoutMs: 1_000,
        recoveryDialogMs: 200,
        logger: captureLogger(),
        env: fakeEnv({ FAKE_WM_RECORD: record.path, FAKE_WM_RECOVERY_DIALOG: 'never' }),
        signal: controller.signal,
        onSpawn: (proc) => proc.onRecoveryDialog(() => dialogs.push(1)),
      });
      await waitUntil(() => dialogs.length > 0, 2_000);
      const began = Date.now();
      controller.abort({ graceMs: 200, termMs: 0 });
      await expect(starting).rejects.toMatchObject({ code: 'START_FAILED' });
      expect(Date.now() - began).toBeLessThan(2_000);
      expect(record.pids().some(isAlive)).toBe(false);
    });
  });

  it('refuses to write after exit', async () => {
    const { proc } = await start();
    await proc.quit();
    expect(() => proc.write(['system info'])).toThrow(WorldMachineError);
  });

  it('quits a starting process when the start is aborted', async () => {
    const record = recorder();
    const controller = new AbortController();
    const starting = WorldMachineProcess.start({
      bin: FAKE_WM,
      readyTimeoutMs: 5_000,
      logger: captureLogger(),
      env: fakeEnv({ FAKE_WM_STARTUP: 'silent', FAKE_WM_RECORD: record.path }),
      signal: controller.signal,
    });
    await waitUntil(() => record.lines().includes('START'));
    controller.abort();
    await expect(starting).rejects.toMatchObject({
      code: 'START_FAILED',
      message: 'World Machine start was cancelled',
    });
    expect(record.lines()).toEqual(['START', 'project close force', 'system quit force', 'EXIT']);
  });

  it('ends a starting process within the abort reason budget', async () => {
    const record = recorder();
    const controller = new AbortController();
    const starting = WorldMachineProcess.start({
      bin: FAKE_WM,
      readyTimeoutMs: 5_000,
      logger: captureLogger(),
      env: fakeEnv({
        FAKE_WM_STARTUP: 'silent',
        FAKE_WM_QUIT_DELAY_MS: '20000',
        FAKE_WM_RECORD: record.path,
      }),
      signal: controller.signal,
    });
    await waitUntil(() => record.lines().includes('START'));
    const began = Date.now();
    controller.abort({ graceMs: 200, termMs: 0 });
    await expect(starting).rejects.toMatchObject({ code: 'START_FAILED' });
    expect(Date.now() - began).toBeLessThan(3_000);
    expect(record.pids().some(isAlive)).toBe(false);
  });

  it('calls onSpawn with the process before it is ready', async () => {
    const record = recorder();
    let spawned: WorldMachineProcess | undefined;
    const starting = WorldMachineProcess.start({
      bin: FAKE_WM,
      readyTimeoutMs: 5_000,
      logger: captureLogger(),
      env: fakeEnv({ FAKE_WM_STARTUP: 'silent', FAKE_WM_RECORD: record.path }),
      onSpawn: (proc) => {
        spawned = proc;
        started.push(proc);
      },
    });
    let settled = false;
    starting.then(
      () => (settled = true),
      () => (settled = true),
    );
    expect(spawned).toBeInstanceOf(WorldMachineProcess);
    await waitUntil(() => record.lines().includes('START'), 2_000);
    expect(settled).toBe(false);
    await spawned?.terminate();
    await expect(starting).rejects.toMatchObject({ code: 'START_FAILED' });
  });

  it('closes a modified project before quitting so no dialog blocks the quit', async () => {
    const record = recorder();
    const { proc } = await start({ FAKE_WM_RECORD: record.path, FAKE_WM_DIRTY_AT_START: '1' });
    const started = Date.now();
    await proc.quit(2_000, 0);
    expect(Date.now() - started).toBeLessThan(1_500);
    const lines = record.lines();
    expect(lines.indexOf('project close force')).toBeGreaterThan(-1);
    expect(lines.indexOf('project close force')).toBeLessThan(lines.indexOf('system quit force'));
    expect(lines).not.toContain('DIALOG');
    expect(lines.at(-1)).toBe('EXIT');
  });

  it('the fake shows the dialog when a modified project is quit without closing it', async () => {
    const record = recorder();
    const { proc } = await start({ FAKE_WM_RECORD: record.path, FAKE_WM_DIRTY_AT_START: '1' });
    proc.write(['system quit force', '']);
    await waitUntil(() => record.lines().includes('DIALOG'));
    expect(proc.exited).toBe(false);
  });

  it.each([
    ['the default quit', undefined],
    ['a kill reason', KILL_ABORT],
  ])(
    'rejects without waiting for readiness when the signal is already aborted (%s)',
    async (_name, reason) => {
      const record = recorder();
      const controller = new AbortController();
      controller.abort(reason);
      let spawned: WorldMachineProcess | undefined;
      const starting = WorldMachineProcess.start({
        bin: FAKE_WM,
        readyTimeoutMs: 5_000,
        logger: captureLogger(),
        env: fakeEnv({ FAKE_WM_STARTUP: 'silent', FAKE_WM_RECORD: record.path }),
        signal: controller.signal,
        onSpawn: (proc) => {
          spawned = proc;
          started.push(proc);
        },
      });
      await expect(starting).rejects.toMatchObject({
        code: 'START_FAILED',
        message: 'World Machine start was cancelled',
      });
      expect(spawned).toBeInstanceOf(WorldMachineProcess);
      expect(spawned?.exited).toBe(true);
      expect(record.pids().some(isAlive)).toBe(false);
    },
  );

  describe('with an injected spawn', () => {
    const options = (spawnFn: typeof spawn) => ({
      bin: FAKE_WM,
      readyTimeoutMs: 5_000,
      logger: captureLogger(),
      env: fakeEnv(),
      spawn: spawnFn,
    });

    it('rejects START_FAILED when the child emits an error, leaving nothing running', async () => {
      const child = new EventEmitter() as ChildProcess;
      let spawned: WorldMachineProcess | undefined;
      const spawnFn = (() => {
        setImmediate(() => child.emit('error', new Error('spawn /bin/sh EAGAIN')));
        return child;
      }) as unknown as typeof spawn;
      const starting = WorldMachineProcess.start({
        ...options(spawnFn),
        onSpawn: (proc) => (spawned = proc),
      });
      await expect(starting).rejects.toMatchObject({
        code: 'START_FAILED',
        message: 'Could not start World Machine: spawn /bin/sh EAGAIN',
      });
      expect(spawned).toBeInstanceOf(WorldMachineProcess);
      expect(spawned?.exited).toBe(true);
    });

    it('survives a second error event from the child', async () => {
      const child = new EventEmitter() as ChildProcess;
      const spawnFn = (() => {
        setImmediate(() => child.emit('error', new Error('first')));
        return child;
      }) as unknown as typeof spawn;
      const logger = captureLogger();
      await expect(WorldMachineProcess.start({ ...options(spawnFn), logger })).rejects.toMatchObject({
        code: 'START_FAILED',
      });
      expect(() => child.emit('error', new Error('second'))).not.toThrow();
      expect(logger.lines).toContain('debug: World Machine process error after startup settled: second');
    });

    it('rejects START_FAILED when spawn throws synchronously', async () => {
      const spawnFn = (() => {
        throw new Error('spawn E2BIG');
      }) as unknown as typeof spawn;
      await expect((async () => WorldMachineProcess.start(options(spawnFn)))()).rejects.toMatchObject({
        code: 'START_FAILED',
        message: 'Could not start World Machine: spawn E2BIG',
      });
    });
    it('refuses to write between exit and close but still delivers late output before onExit', async () => {
      const child = Object.assign(new EventEmitter(), {
        pid: 4242,
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        kill: () => true,
      });
      const spawnFn = (() => child) as unknown as typeof spawn;
      const starting = WorldMachineProcess.start(options(spawnFn));
      child.stdout.write(`[Info       ] ${READY_LINE}\n`);
      const proc = await starting;
      const events: string[] = [];
      proc.onLine((line) => events.push(line));
      proc.onExit(() => events.push('<exit>'));
      child.emit('exit', 0, null);
      expect(() => proc.write(['system info'])).toThrow(
        expect.objectContaining({ code: 'CRASHED', message: 'World Machine is not running' }),
      );
      child.stdout.write('late line\n');
      await waitUntil(() => events.includes('late line'));
      expect(events).toEqual(['late line']);
      child.stdout.end();
      child.emit('close', 0, null);
      await waitUntil(() => proc.exited);
      expect(events).toEqual(['late line', '<exit>']);
    });
  });
});

describe('WorldMachineProcess build events (spec v2a section 5)', () => {
  /** A process over in-memory pipes, so a test decides exactly which lines arrive and when. */
  async function pipedProcess() {
    const child = Object.assign(new EventEmitter(), {
      pid: 4243,
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      kill: () => true,
    });
    const logger = captureLogger();
    const starting = WorldMachineProcess.start({
      bin: FAKE_WM,
      readyTimeoutMs: 5_000,
      logger,
      env: fakeEnv(),
      spawn: (() => child) as unknown as typeof spawn,
    });
    child.stdout.write(`[Info       ] ${READY_LINE}\n`);
    return { child, proc: await starting, logger };
  }

  it('delivers build events between batches to build listeners only, and logs them at debug level', async () => {
    const { child, proc, logger } = await pipedProcess();
    const lines: string[] = [];
    const events: string[] = [];
    proc.onLine((line) => lines.push(line));
    proc.onBuildEvent((event) => events.push(event));
    // raw/v2-build-isolate.txt l.61-68, then a preview's answer, which is not an event (fact 42).
    child.stdout.write(
      '[Build Event] *** Build Ended ***\n[Build Event] System allowed to sleep again\nBuild started.\nPreview build started.\n',
    );
    await waitUntil(() => lines.length === 1);
    expect(events).toEqual(['ended', 'sleep-allowed', 'build-started']);
    expect(lines).toEqual(['Preview build started.']);
    expect(logger.lines).toContain('debug: World Machine build event: [Build Event] *** Build Ended ***');
  });

  it('removes build events from the frame of a pending batch and delivers them (raw/v2-build-isolate.txt l.146-153)', async () => {
    const { child, proc } = await pipedProcess();
    const events: string[] = [];
    proc.onBuildEvent((event) => events.push(event));
    const queue = new CommandQueue(proc, { timeoutMs: 2_000, nudgeMs: 0, newBatchId: () => 'b1' });
    const pending = queue.execute(['export list', 'build start']);
    // The queue writes the batch on a later tick; answer only once it is waiting.
    await waitUntil(() => child.stdin.readableLength > 0);
    child.stdout.write(
      [
        'Configured exports:',
        "  'Height Output       ' -> <project> <name>-<res>.png",
        '',
        'Build started.',
        "Error: Unknown command: '__end_b1_0'. Type 'help' for a list of commands.",
        '[Build Event] Prohibiting system sleep',
        '[Build Event] *** Build Starting ***',
        "Error: Unknown command: '__end_b1_1'. Type 'help' for a list of commands.",
        '',
      ].join('\n'),
    );
    const [list, start] = await pending;
    expect(list?.output).toEqual([
      'Configured exports:',
      "  'Height Output       ' -> <project> <name>-<res>.png",
    ]);
    expect(start).toEqual({ command: 'build start', output: [], errors: [] });
    expect(events).toEqual(['build-started', 'sleep-prohibited', 'starting']);
  });

  it('keeps any other [Build Event] line out of a pending frame (raw/v2b-assumptions.txt l.159-162, v2b fact 71)', async () => {
    const { child, proc, logger } = await pipedProcess();
    const events: string[] = [];
    proc.onBuildEvent((event) => events.push(event));
    const queue = new CommandQueue(proc, { timeoutMs: 2_000, nudgeMs: 0, newBatchId: () => 'b1' });
    const pending = queue.execute(['group build #1']);
    await waitUntil(() => child.stdin.readableLength > 0);
    const exported = '[Build Event] Automatic export of file /work/assume Height Output-257.png succeeded';
    child.stdout.write(
      [
        '[Build Event] Prohibiting system sleep',
        '[Build Event] *** Build Starting ***',
        exported,
        "Error: Unknown command: '__end_b1_0'. Type 'help' for a list of commands.",
        '',
      ].join('\n'),
    );
    const [start] = await pending;
    expect(start).toEqual({ command: 'group build #1', output: [], errors: [] });
    expect(events).toEqual(['sleep-prohibited', 'starting', 'other']);
    expect(logger.lines).toContain(`debug: World Machine build event: ${exported}`);
  });
});
