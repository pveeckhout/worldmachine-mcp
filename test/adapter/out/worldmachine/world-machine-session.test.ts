import { mkdirSync, mkdtempSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FsPathPolicy } from '../../../../src/adapter/out/fs/path-policy.js';
import { WorldMachineProcess } from '../../../../src/adapter/out/worldmachine/world-machine-process.js';
import {
  type SessionOptions,
  WorldMachineSession,
} from '../../../../src/adapter/out/worldmachine/world-machine-session.js';
import { WorldMachineError } from '../../../../src/domain/errors.js';
import { captureLogger, FAKE_WM, fakeEnv, isAlive, recorder, waitUntil } from '../../../support/fake-wm.js';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'session-')));
mkdirSync(join(root, 'dir with space'));
const project = join(root, 'dir with space', 'world.tmd');
writeFileSync(project, '');
const outsideProject = join(realpathSync(mkdtempSync(join(tmpdir(), 'outside-'))), 'x.tmd');
writeFileSync(outsideProject, '');

const sessions: WorldMachineSession[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.shutdown()));
});

function session(extra: Record<string, string> = {}, overrides: Partial<SessionOptions> = {}) {
  const record = recorder();
  const logger = captureLogger();
  const env = fakeEnv({ FAKE_WM_RECORD: record.path, ...extra });
  const created = new WorldMachineSession({
    executable: FAKE_WM,
    defaultProject: undefined,
    pathPolicy: new FsPathPolicy([root]),
    commandTimeoutMs: 2_000,
    idleTimeoutMs: 0,
    logger,
    startProcess: (bin, signal, onSpawn) =>
      WorldMachineProcess.start({ bin, readyTimeoutMs: 5_000, logger, env, signal, onSpawn }),
    ...overrides,
  });
  sessions.push(created);
  return { session: created, record, logger };
}

async function failure(promise: Promise<unknown>): Promise<WorldMachineError> {
  try {
    await promise;
  } catch (error) {
    return error as WorldMachineError;
  }
  throw new Error('expected rejection');
}

const SENTINEL = expect.stringMatching(/^__end_/);

describe('WorldMachineSession', () => {
  it('does not start World Machine until needed', () => {
    const { session: s, record } = session();
    expect(s.status()).toEqual({ executable: FAKE_WM, session: { state: 'notRunning' } });
    expect(record.lines()).toEqual([]);
  });

  it('starts, reads system info, and creates a fresh default project', async () => {
    const { session: s, record } = session();
    await s.ensureRunning();
    expect(record.lines()).toEqual(['START', 'system info', SENTINEL, 'project new default force', SENTINEL]);
    expect(s.status()).toEqual({
      executable: FAKE_WM,
      session: { state: 'ready', binding: { kind: 'fresh' }, dirty: false },
      systemInfo: { build: 4067, buildName: 'Dragontail Peak', arch: 'x64-AVX2 (256-bit)' },
    });
  });

  it('starts once under concurrent calls', async () => {
    const { session: s, record } = session();
    await Promise.all([s.ensureRunning(), s.ensureRunning(), s.executeOne('device list')]);
    expect(record.lines().filter((line) => line === 'START')).toHaveLength(1);
  });

  it('opens an authorised default project, including a path with spaces', async () => {
    const { session: s, record } = session({}, { defaultProject: project });
    await s.ensureRunning();
    expect(record.lines()).toContain(`project open ${project}`);
    expect(s.status().session.binding).toEqual({ kind: 'opened', path: project });
  });

  it('fails with REFUSED, without launching World Machine, when the default project is not authorised', async () => {
    const { session: s, record } = session({}, { defaultProject: outsideProject });
    const error = await failure(s.ensureRunning());
    expect(error.code).toBe('REFUSED');
    expect(error.message).toContain('WORLD_MACHINE_DEFAULT_PROJECT');
    expect(record.lines()).toEqual([]);
    expect(s.status().session).toEqual({ state: 'notRunning' });
  });

  it('fails with NOT_CONFIGURED when a default project is set but there are no allowed roots', async () => {
    const { session: s } = session({}, { defaultProject: project, pathPolicy: new FsPathPolicy(null) });
    expect((await failure(s.ensureRunning())).code).toBe('NOT_CONFIGURED');
  });

  it('fails with WM_COMMAND_FAILED and stops World Machine when the default project cannot be opened', async () => {
    const { session: s, record } = session({ FAKE_WM_OPEN_ERROR: '1' }, { defaultProject: project });
    const error = await failure(s.ensureRunning());
    expect(error.code).toBe('WM_COMMAND_FAILED');
    expect(error.worldMachineMessage).toBe('Failed to open project.');
    expect(s.status().session).toEqual({ state: 'notRunning' });
    expect(record.lines().at(-1)).toBe('EXIT');
  });

  it('reports NOT_CONFIGURED without an executable', async () => {
    const { session: s } = session({}, { executable: null });
    expect((await failure(s.ensureRunning())).code).toBe('NOT_CONFIGURED');
  });

  it('can retry after a failed start', async () => {
    let attempt = 0;
    const logger = captureLogger();
    const { session: s } = session(
      {},
      {
        startProcess: (bin, signal, onSpawn) =>
          WorldMachineProcess.start({
            bin,
            readyTimeoutMs: 5_000,
            logger,
            signal,
            onSpawn,
            env: fakeEnv(attempt++ === 0 ? { FAKE_WM_STARTUP: 'exit' } : {}),
          }),
      },
    );
    expect((await failure(s.ensureRunning())).code).toBe('START_FAILED');
    expect(s.status().session).toEqual({ state: 'notRunning' });
    await s.ensureRunning();
    expect(s.status().session.state).toBe('ready');
  });

  it('becomes unhealthy on TIMEOUT and restarts only after the old process has exited', async () => {
    const { session: s, record } = session({ FAKE_WM_HANG_ON: 'device list' }, { commandTimeoutMs: 300 });
    expect((await failure(s.executeOne('device list'))).code).toBe('TIMEOUT');
    expect(s.status().session.state).toBe('unhealthy');
    await s.ensureRunning();
    expect(record.lines().filter((line) => line === 'START')).toHaveLength(2);
  });

  it('stays notRunning when a start triggered through executeOne times out', async () => {
    const { session: s } = session({ FAKE_WM_HANG_ON: 'system info' }, { commandTimeoutMs: 300 });
    expect((await failure(s.executeOne('device list'))).code).toBe('TIMEOUT');
    expect(s.status().session).toEqual({ state: 'notRunning' });
  });

  it('becomes unhealthy when World Machine crashes', async () => {
    const { session: s } = session({ FAKE_WM_CRASH_ON: 'device list' });
    expect((await failure(s.executeOne('device list'))).code).toBe('CRASHED');
    expect(s.status().session).toEqual({ state: 'unhealthy', reason: 'World Machine exited unexpectedly' });
  });

  it('quits World Machine after the idle timeout', async () => {
    const { session: s, record } = session({}, { idleTimeoutMs: 200 });
    await s.ensureRunning();
    await waitUntil(() => record.lines().includes('EXIT'));
    expect(record.lines()).toContain('system quit force');
    expect(s.status().session.state).toBe('notRunning');
  });

  it('does not let the idle timeout interrupt a running command', async () => {
    const { session: s, record } = session(
      { FAKE_WM_DELAY_ON: 'device list', FAKE_WM_DELAY_MS: '500' },
      { idleTimeoutMs: 150 },
    );
    await s.ensureRunning();
    const response = await s.executeOne('device list');
    expect(response.output).toHaveLength(18);
    expect(s.status().session.state).toBe('ready');
    const lines = record.lines();
    expect(
      lines.indexOf('system quit force') === -1 ||
        lines.indexOf('system quit force') > lines.indexOf('device list'),
    ).toBe(true);
  });

  it('starts a new process only after an idle stop has finished', async () => {
    const { session: s, record } = session({ FAKE_WM_QUIT_DELAY_MS: '300' }, { idleTimeoutMs: 100 });
    await s.ensureRunning();
    await waitUntil(() => record.lines().includes('system quit force'));
    await s.ensureRunning();
    const lines = record.lines();
    expect(lines.indexOf('EXIT')).toBeGreaterThan(-1);
    expect(lines.indexOf('EXIT')).toBeLessThan(lines.lastIndexOf('START'));
  });

  it('lets a running command finish before shutdown quits World Machine', async () => {
    const { session: s, record } = session({ FAKE_WM_DELAY_ON: 'device list', FAKE_WM_DELAY_MS: '300' });
    await s.ensureRunning();
    const running = s.executeOne('device list');
    await waitUntil(() => record.lines().includes('device list'));
    const queued = s.executeOne('system info');
    await s.shutdown();
    expect((await running).output).toHaveLength(18);
    expect((await queued).output.length).toBeGreaterThan(0);
    const lines = record.lines();
    expect(lines.indexOf('system quit force')).toBeGreaterThan(lines.indexOf('device list') + 1);
    expect(s.status().session).toEqual({ state: 'stopping' });
  });

  it('cancels a start that is still waiting for readiness when shut down', async () => {
    const { session: s, record } = session({ FAKE_WM_STARTUP: 'silent' });
    const starting = failure(s.ensureRunning());
    await waitUntil(() => record.lines().includes('START'));
    await s.shutdown();
    expect((await starting).code).toBe('SHUTTING_DOWN');
    expect(record.lines().at(-1)).toBe('EXIT');
  });

  it('does not return from shutdown while an idle stop is still quitting', async () => {
    const { session: s, record } = session({ FAKE_WM_QUIT_DELAY_MS: '400' }, { idleTimeoutMs: 100 });
    await s.ensureRunning();
    await waitUntil(() => record.lines().includes('system quit force'));
    await s.shutdown();
    expect(record.lines().at(-1)).toBe('EXIT');
  });

  it('refuses to start after shutdown', async () => {
    const { session: s } = session();
    await s.shutdown();
    expect((await failure(s.ensureRunning())).code).toBe('SHUTTING_DOWN');
  });

  it('bounds shutdown by the given budget when World Machine quits slowly', async () => {
    const { session: s, record } = session({ FAKE_WM_QUIT_DELAY_MS: '5000' });
    await s.ensureRunning();
    const started = Date.now();
    await s.shutdown({ drainMs: 0, graceMs: 300, termMs: 0 });
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(record.pids().some(isAlive)).toBe(false);
  });

  it('caps the drain of a running batch at drainMs', async () => {
    const { session: s, record } = session({ FAKE_WM_DELAY_ON: 'device list', FAKE_WM_DELAY_MS: '5000' });
    await s.ensureRunning();
    const running = failure(s.executeOne('device list'));
    await waitUntil(() => record.lines().includes('device list'));
    const started = Date.now();
    await s.shutdown({ drainMs: 200, graceMs: 200, termMs: 200 });
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(record.pids().some(isAlive)).toBe(false);
    expect((await running).code).toBe('SHUTTING_DOWN');
  });

  it('rejects a batch whose own timeout fires inside the shutdown drain with TIMEOUT', async () => {
    const { session: s, record } = session({ FAKE_WM_HANG_ON: 'device list' }, { commandTimeoutMs: 300 });
    await s.ensureRunning();
    const running = failure(s.executeOne('device list'));
    await waitUntil(() => record.lines().includes('device list'));
    const started = Date.now();
    // The drain window (5 s) is far longer than the batch timeout (300 ms), so the timeout ends the drain.
    await s.shutdown({ drainMs: 5_000, graceMs: 300, termMs: 300 });
    expect(Date.now() - started).toBeLessThan(3_000);
    expect((await running).code).toBe('TIMEOUT');
    // Close-then-quit was still attempted (the hung fake ignores both), and the process is gone.
    expect(record.lines()).toEqual(expect.arrayContaining(['project close force', 'system quit force']));
    expect(record.pids().some(isAlive)).toBe(false);
  });

  it('kill() ends a slow shutdown promptly', async () => {
    const { session: s, record } = session({ FAKE_WM_QUIT_DELAY_MS: '5000' });
    await s.ensureRunning();
    const shutdown = s.shutdown();
    await waitUntil(() => record.lines().includes('system quit force'));
    const started = Date.now();
    await s.kill();
    await shutdown;
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(record.pids().some(isAlive)).toBe(false);
  });

  it('kill() also ends a start that is still waiting for readiness', async () => {
    const { session: s, record } = session({ FAKE_WM_STARTUP: 'silent' });
    const starting = failure(s.ensureRunning());
    await waitUntil(() => record.lines().includes('START'));
    const started = Date.now();
    await s.kill();
    expect((await starting).code).toBe('SHUTTING_DOWN');
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(record.pids().some(isAlive)).toBe(false);
  });

  it('shutdown with a signal budget ends a start that is not ready yet within the budget', async () => {
    const { session: s, record } = session({ FAKE_WM_STARTUP: 'silent', FAKE_WM_QUIT_DELAY_MS: '20000' });
    const starting = failure(s.ensureRunning());
    await waitUntil(() => record.lines().includes('START'));
    const started = Date.now();
    await s.shutdown({ drainMs: 0, graceMs: 500, termMs: 0 });
    expect(Date.now() - started).toBeLessThan(3_000);
    expect((await starting).code).toBe('SHUTTING_DOWN');
    expect(record.pids().some(isAlive)).toBe(false);
  });

  it('kill() during a shutdown ends a start that is not ready yet at once', async () => {
    const { session: s, record } = session({ FAKE_WM_STARTUP: 'silent', FAKE_WM_QUIT_DELAY_MS: '20000' });
    const starting = failure(s.ensureRunning());
    await waitUntil(() => record.lines().includes('START'));
    const shutdown = s.shutdown();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const started = Date.now();
    await s.kill();
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(record.pids().some(isAlive)).toBe(false);
    await shutdown;
    expect((await starting).code).toBe('SHUTTING_DOWN');
  });

  it('kill() ends a World Machine that is being quit after a failed setup', async () => {
    const { session: s, record } = session(
      { FAKE_WM_OPEN_ERROR: '1', FAKE_WM_QUIT_DELAY_MS: '20000' },
      { defaultProject: project },
    );
    const starting = failure(s.ensureRunning());
    await waitUntil(() => record.lines().includes('system quit force'));
    const started = Date.now();
    await s.kill();
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(record.pids().some(isAlive)).toBe(false);
    expect((await starting).code).toBe('WM_COMMAND_FAILED');
  });

  it('shutdown during setup applies its budget without waiting for the setup command', async () => {
    const { session: s, record } = session({
      FAKE_WM_DELAY_ON: 'system info',
      FAKE_WM_DELAY_MS: '20000',
      FAKE_WM_QUIT_DELAY_MS: '0',
    });
    const starting = failure(s.ensureRunning());
    await waitUntil(() => record.lines().includes('system info'));
    const started = Date.now();
    await s.shutdown({ drainMs: 500, graceMs: 1_000, termMs: 300 });
    expect(Date.now() - started).toBeLessThan(3_000);
    await starting;
    expect(record.pids().some(isAlive)).toBe(false);
  });

  it('tracks unsaved changes and resets them on bind', async () => {
    const { session: s } = session();
    s.markDirty();
    expect(s.status().session.state).toBe('notRunning');
    await s.ensureRunning();
    s.markDirty();
    expect(s.status().session).toEqual({ state: 'ready', binding: { kind: 'fresh' }, dirty: true });
    s.bind({ kind: 'opened', path: '/p/x.tmd' });
    expect(s.status().session).toEqual({
      state: 'ready',
      binding: { kind: 'opened', path: '/p/x.tmd' },
      dirty: false,
    });
  });

  it('refuses calls with SHUTTING_DOWN once shutdown has begun', async () => {
    const { session: s, record } = session();
    await s.shutdown();
    expect((await failure(s.executeOne('device list'))).code).toBe('SHUTTING_DOWN');
    expect(record.lines()).toEqual([]);
  });

  it('reports stopping and refuses exclusive actions once shutdown has begun', async () => {
    const { session: s } = session();
    await s.ensureRunning();
    let ran = false;
    const stopping = s.shutdown();
    expect(s.status().session).toEqual({ state: 'stopping' });
    const refused = await failure(
      s.exclusive(async () => {
        ran = true;
      }),
    );
    await stopping;
    expect(refused.code).toBe('SHUTTING_DOWN');
    expect(ran).toBe(false);
  });

  it('can idle-quit again once a dirty session becomes clean', async () => {
    const { session: s, record } = session({}, { idleTimeoutMs: 200 });
    await s.ensureRunning();
    s.markDirty();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(record.lines()).not.toContain('system quit force');
    s.bind({ kind: 'fresh' });
    await waitUntil(() => record.lines().includes('system quit force'));
  });

  it('refuses batches still queued when the shutdown drain ends', async () => {
    const { session: s, record } = session({ FAKE_WM_DELAY_ON: 'device list', FAKE_WM_DELAY_MS: '3000' });
    await s.ensureRunning();
    const running = failure(s.executeOne('device list'));
    await waitUntil(() => record.lines().includes('device list'));
    const queued = failure(s.executeOne('system info'));
    // Let the queued call reach the queue (it has no observable effect before it runs) before the shutdown starts.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await s.shutdown({ drainMs: 100, graceMs: 500, termMs: 0 });
    expect((await queued).code).toBe('SHUTTING_DOWN');
    expect((await running).code).toBe('SHUTTING_DOWN');
  });

  it('rejects an unconfirmed default project with UNEXPECTED_OUTPUT', async () => {
    const { session: s } = session({ FAKE_WM_SILENT_ON: 'project new default force' });
    const starting = failure(s.ensureRunning());
    const error = await starting;
    expect(error.code).toBe('UNEXPECTED_OUTPUT');
  });

  it('runs exclusive actions one at a time', async () => {
    const { session: s } = session();
    const order: string[] = [];
    const slow = s.exclusive(async () => {
      order.push('a-start');
      await new Promise((resolve) => setTimeout(resolve, 50));
      order.push('a-end');
    });
    const fast = s.exclusive(async () => {
      order.push('b');
    });
    await Promise.all([slow, fast]);
    expect(order).toEqual(['a-start', 'a-end', 'b']);
  });

  it('refuses an exclusive action queued before shutdown when its turn comes', async () => {
    const { session: s } = session();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let bRan = false;
    let aStarted = false;
    const a = s.exclusive(async () => {
      aStarted = true;
      await gate;
      return 'a';
    });
    await waitUntil(() => aStarted);
    const b = failure(
      s.exclusive(async () => {
        bRan = true;
      }),
    );
    const stopping = s.shutdown();
    release();
    expect(await a).toBe('a');
    expect((await b).code).toBe('SHUTTING_DOWN');
    await stopping;
    expect(bRan).toBe(false);
  });

  it('keeps running exclusive actions after one rejects', async () => {
    const { session: s } = session();
    const a = failure(
      s.exclusive(async () => {
        throw new WorldMachineError('REFUSED', 'nope');
      }),
    );
    const b = s.exclusive(async () => 'b');
    expect((await a).code).toBe('REFUSED');
    expect(await b).toBe('b');
  });

  it('names lost changes when World Machine crashes while dirty', async () => {
    const { session: s } = session({ FAKE_WM_CRASH_ON: 'device list' });
    await s.ensureRunning();
    s.markDirty();
    const error = await failure(s.executeOne('device list'));
    expect(error.code).toBe('CRASHED');
    expect(error.message).toBe('World Machine exited unexpectedly; unsaved changes were lost');
    expect(s.status().session).toEqual({
      state: 'unhealthy',
      reason: 'World Machine exited unexpectedly; unsaved changes were lost',
    });
  });
});

const sinceLastStart = (lines: string[]): string[] => lines.slice(lines.lastIndexOf('START'));

describe('WorldMachineSession restart (spec section 6)', () => {
  it('reopens the opened project after an idle quit', async () => {
    const { session: s, record } = session({}, { idleTimeoutMs: 200 });
    await s.ensureRunning();
    s.bind({ kind: 'opened', path: project });
    await waitUntil(() => record.lines().includes('EXIT'));
    await s.ensureRunning();
    const restart = sinceLastStart(record.lines());
    expect(restart).toContain(`project open ${project}`);
    expect(restart).not.toContain('project new default force');
    expect(s.status().session).toEqual({
      state: 'ready',
      binding: { kind: 'opened', path: project },
      dirty: false,
    });
  });

  it('does not reopen a deleted project after forgetReopen, so an open or create start succeeds', async () => {
    const gone = join(root, 'gone-forget.tmd');
    writeFileSync(gone, '');
    const { session: s, record } = session({}, { idleTimeoutMs: 200 });
    await s.ensureRunning();
    s.bind({ kind: 'opened', path: gone });
    await waitUntil(() => record.lines().includes('EXIT'));
    unlinkSync(gone);
    s.forgetReopen();
    await s.ensureRunning();
    const restart = sinceLastStart(record.lines());
    expect(restart).toContain('project new default force');
    expect(restart).not.toContain(`project open ${gone}`);
    expect(s.status().session.binding).toEqual({ kind: 'fresh' });
  });

  it('reopens the opened project after a clean unexpected exit', async () => {
    const { session: s, record } = session({ FAKE_WM_CRASH_ON: 'device list' });
    await s.ensureRunning();
    s.bind({ kind: 'opened', path: project });
    expect((await failure(s.executeOne('device list'))).code).toBe('CRASHED');
    await s.ensureRunning();
    const restart = sinceLastStart(record.lines());
    expect(restart).toContain(`project open ${project}`);
    expect(restart).not.toContain('project new default force');
    expect(s.status().session.binding).toEqual({ kind: 'opened', path: project });
  });

  it('opens the default project after an unexpected exit with unsaved changes', async () => {
    const { session: s, record } = session({ FAKE_WM_CRASH_ON: 'device list' });
    await s.ensureRunning();
    s.bind({ kind: 'opened', path: project });
    s.markDirty();
    expect((await failure(s.executeOne('device list'))).code).toBe('CRASHED');
    await s.ensureRunning();
    const restart = sinceLastStart(record.lines());
    expect(restart).toContain('project new default force');
    expect(restart).not.toContain(`project open ${project}`);
    expect(s.status().session.binding).toEqual({ kind: 'fresh' });
  });

  it('opens the default project after a timeout restart', async () => {
    const { session: s, record } = session({ FAKE_WM_HANG_ON: 'device list' }, { commandTimeoutMs: 300 });
    await s.ensureRunning();
    s.bind({ kind: 'opened', path: project });
    expect((await failure(s.executeOne('device list'))).code).toBe('TIMEOUT');
    await s.ensureRunning();
    const restart = sinceLastStart(record.lines());
    expect(restart).toContain('project new default force');
    expect(restart).not.toContain(`project open ${project}`);
    expect(s.status().session.binding).toEqual({ kind: 'fresh' });
  });

  it('refuses to reopen a removed project without launching, then starts with the default project', async () => {
    const gone = join(root, 'gone.tmd');
    writeFileSync(gone, '');
    const { session: s, record } = session({ FAKE_WM_CRASH_ON: 'device list' });
    await s.ensureRunning();
    s.bind({ kind: 'opened', path: gone });
    expect((await failure(s.executeOne('device list'))).code).toBe('CRASHED');
    unlinkSync(gone);
    const error = await failure(s.ensureRunning());
    expect(error.code).toBe('REFUSED');
    expect(error.message).toBe(
      `The last open project cannot be reopened: Not an existing .tmd project file inside the allowed roots: ${gone}`,
    );
    expect(record.lines().filter((line) => line === 'START')).toHaveLength(1);
    await s.ensureRunning();
    expect(sinceLastStart(record.lines())).toContain('project new default force');
    expect(s.status().session.binding).toEqual({ kind: 'fresh' });
  });

  it('fails the restart when the reopened project cannot be opened, then starts with the default project', async () => {
    const record = recorder();
    const logger = captureLogger();
    let attempt = 0;
    const { session: s } = session(
      {},
      {
        startProcess: (bin, signal, onSpawn) =>
          WorldMachineProcess.start({
            bin,
            readyTimeoutMs: 5_000,
            logger,
            signal,
            onSpawn,
            env: fakeEnv({
              FAKE_WM_RECORD: record.path,
              FAKE_WM_CRASH_ON: 'device list',
              ...(attempt++ === 0 ? {} : { FAKE_WM_OPEN_ERROR: '1' }),
            }),
          }),
      },
    );
    await s.ensureRunning();
    s.bind({ kind: 'opened', path: project });
    expect((await failure(s.executeOne('device list'))).code).toBe('CRASHED');
    const error = await failure(s.ensureRunning());
    expect(error.code).toBe('WM_COMMAND_FAILED');
    expect(error.worldMachineMessage).toBe('Failed to open project.');
    expect(sinceLastStart(record.lines())).toContain(`project open ${project}`);
    expect(s.status().session).toEqual({ state: 'notRunning' });
    expect(record.lines().at(-1)).toBe('EXIT');
    // Spec section 6: the failed reopen forgot the path, so the next start opens the default project.
    await s.ensureRunning();
    const third = sinceLastStart(record.lines());
    expect(third).toContain('project new default force');
    expect(third).not.toContain(`project open ${project}`);
    expect(s.status().session.binding).toEqual({ kind: 'fresh' });
  });
});
