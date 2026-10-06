import type { ChildProcess, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { copyFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
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

  it('fails at once with a fixed message and no detail when World Machine has no licence', async () => {
    const record = recorder();
    const began = Date.now();
    const error = await startFailure({ FAKE_WM_UNLICENSED: '1', FAKE_WM_RECORD: record.path });
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
        readyTimeoutMs: 5_000,
        logger,
        env: fakeEnv({ FAKE_WM_UNLICENSED: '1' }),
      }),
    ).rejects.toThrow(NO_LICENCE);
    expect(logger.lines.filter((line) => line.startsWith('error:'))).toHaveLength(1);
    expect(logger.lines.filter((line) => line === `error: ${NO_LICENCE_LOG}`)).toHaveLength(1);
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
