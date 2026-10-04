import { copyFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WorldMachineProcess } from '../../../../src/adapter/out/worldmachine/world-machine-process.js';
import { WorldMachineError } from '../../../../src/domain/errors.js';
import { captureLogger, FAKE_WM, fakeEnv, isAlive, recorder, waitUntil } from '../../../support/fake-wm.js';

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
    expect(record.lines()).toEqual(['START', 'system quit force', 'EXIT']);
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

  it('fails with START_FAILED when World Machine exits before ready, without log or licence text', async () => {
    const error = await startFailure({ FAKE_WM_STARTUP: 'exit' });
    expect(error.code).toBe('START_FAILED');
    expect(error.worldMachineMessage).toBe('fatal: simulated startup failure');
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
    expect(record.lines()).toEqual(['START', 'system quit force', 'EXIT']);
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
});
