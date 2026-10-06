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
    expect(record.lines()).toContain(`project open ${project} force`);
    expect(s.status().session.binding).toEqual({ kind: 'opened', path: project });
  });

  it('opens the default project with force when World Machine counts its start-up project as unsaved', async () => {
    const { session: s, record } = session({ FAKE_WM_STARTUP_UNSAVED: '1' }, { defaultProject: project });
    await s.ensureRunning();
    expect(record.lines()).toContain(`project open ${project} force`);
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

  it('reports lost changes when a batch is written after the process exited but before it closed', async () => {
    const exitListeners: (() => void)[] = [];
    let lineListener: (line: string) => void = () => undefined;
    let exitSeen = false;
    const stub = {
      exited: false,
      onLine: (listener: (line: string) => void) => {
        lineListener = listener;
      },
      onExit: (listener: () => void) => exitListeners.push(listener),
      onBuildEvent: () => undefined,
      write: (lines: readonly string[]) => {
        if (exitSeen) throw new WorldMachineError('CRASHED', 'World Machine is not running');
        for (const line of lines) {
          if (line === 'system info') lineListener("  Version:  Build 4067 'Dragontail Peak'");
          if (line === 'system info') lineListener('  Arch:     x64-AVX2 (256-bit)');
          if (line === 'project new default force') lineListener('Created new default project.');
          if (line.startsWith('__end_')) lineListener(`Error: Unknown command: '${line}'`);
        }
      },
      quit: () => Promise.resolve(),
      terminate: () => Promise.resolve(),
    };
    const { session: s } = session(
      {},
      { startProcess: () => Promise.resolve(stub as unknown as WorldMachineProcess) },
    );
    await s.ensureRunning();
    s.markDirty();
    exitSeen = true;
    const pending = failure(s.executeOne('device list'));
    await new Promise((resolve) => setImmediate(resolve));
    for (const listener of exitListeners) listener();
    const error = await pending;
    expect(error.code).toBe('CRASHED');
    expect(error.message).toContain('unsaved changes were lost');
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

  it('shutdown applies its own budget to a failed setup that is already quitting a hung World Machine', async () => {
    const { session: s, record } = session(
      { FAKE_WM_OPEN_ERROR: '1', FAKE_WM_QUIT_DELAY_MS: '20000' },
      { defaultProject: project },
    );
    const starting = failure(s.ensureRunning());
    await waitUntil(() => record.lines().includes('system quit force'));
    const started = Date.now();
    await s.shutdown({ drainMs: 100, graceMs: 200, termMs: 200 });
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
    expect(restart).toContain(`project open ${project} force`);
    expect(restart).not.toContain('project new default force');
    expect(s.status().session).toEqual({
      state: 'ready',
      binding: { kind: 'opened', path: project },
      dirty: false,
    });
  });

  it('reopens with force after an idle quit when the start-up project counts as unsaved', async () => {
    const { session: s, record } = session({ FAKE_WM_STARTUP_UNSAVED: '1' }, { idleTimeoutMs: 200 });
    await s.ensureRunning();
    s.bind({ kind: 'opened', path: project });
    await waitUntil(() => record.lines().includes('EXIT'));
    await s.ensureRunning();
    expect(sinceLastStart(record.lines())).toContain(`project open ${project} force`);
    expect(s.status().session.binding).toEqual({ kind: 'opened', path: project });
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
    expect(restart).not.toContain(`project open ${gone} force`);
    expect(s.status().session.binding).toEqual({ kind: 'fresh' });
  });

  it('reopens the opened project after a clean unexpected exit', async () => {
    const { session: s, record } = session({ FAKE_WM_CRASH_ON: 'device list' });
    await s.ensureRunning();
    s.bind({ kind: 'opened', path: project });
    expect((await failure(s.executeOne('device list'))).code).toBe('CRASHED');
    await s.ensureRunning();
    const restart = sinceLastStart(record.lines());
    expect(restart).toContain(`project open ${project} force`);
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
    expect(restart).not.toContain(`project open ${project} force`);
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
    expect(restart).not.toContain(`project open ${project} force`);
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
    expect(sinceLastStart(record.lines())).toContain(`project open ${project} force`);
    expect(s.status().session).toEqual({ state: 'notRunning' });
    expect(record.lines().at(-1)).toBe('EXIT');
    // Spec section 6: the failed reopen forgot the path, so the next start opens the default project.
    await s.ensureRunning();
    const third = sinceLastStart(record.lines());
    expect(third).toContain('project new default force');
    expect(third).not.toContain(`project open ${project} force`);
    expect(s.status().session.binding).toEqual({ kind: 'fresh' });
  });
});

describe('WorldMachineSession builds (spec v2a section 5)', () => {
  it('creates a build tracker for each process that sees its build events', async () => {
    const { session: s } = session({ FAKE_WM_BUILD_MS: '5000' });
    expect(s.buildTracker()).toBeUndefined();
    await s.ensureRunning();
    const tracker = s.buildTracker();
    tracker?.expect('full');
    expect((await s.executeOne('build start')).output).toEqual([]);
    expect(tracker?.snapshot()).toMatchObject({ mode: 'full', startedBy: 'server', state: 'running' });
  });

  it('refuses exclusive actions while a full build runs, and runs them once it ended', async () => {
    const { session: s } = session({ FAKE_WM_BUILD_MS: '300' });
    await s.ensureRunning();
    await s.executeOne('build start');
    let ran = false;
    const refused = await failure(
      s.exclusive(async () => {
        ran = true;
      }),
    );
    expect(refused).toMatchObject({
      code: 'REFUSED',
      message: 'A build is running; call stop_build or wait for it to finish',
    });
    expect(ran).toBe(false);
    expect(await s.buildTracker()?.ended(2_000)).toBe(true);
    await s.exclusive(async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  it('does not refuse exclusive actions during a preview (spec v2a section 4)', async () => {
    const { session: s } = session({ FAKE_WM_PREVIEW_MS: '5000' });
    await s.ensureRunning();
    await s.executeOne('build preview');
    expect(await s.exclusive(async () => 'ran')).toBe('ran');
  });

  it('keeps a build end that arrives inside another batch out of its frame (fact 47)', async () => {
    const { session: s } = session({ FAKE_WM_BUILD_MS: '60000', FAKE_WM_BUILD_END_ON: 'device list' });
    await s.ensureRunning();
    await s.executeOne('build start');
    expect(s.buildTracker()?.running).toBe(true);
    const list = await s.executeOne('device list');
    expect(list.output).toHaveLength(18);
    expect(list.output.some((line) => line.includes('Build'))).toBe(false);
    expect(s.buildTracker()?.running).toBe(false);
  });

  it('drops the run when World Machine exits, failing a wait with CRASHED', async () => {
    const { session: s } = session({ FAKE_WM_BUILD_MS: '60000', FAKE_WM_CRASH_ON: 'device list' });
    await s.ensureRunning();
    await s.executeOne('build start');
    const tracker = s.buildTracker();
    const ended = tracker?.ended(60_000);
    expect((await failure(s.executeOne('device list'))).code).toBe('CRASHED');
    await expect(ended).rejects.toMatchObject({ code: 'CRASHED' });
    expect(tracker?.running).toBe(false);
    expect(await s.exclusive(async () => 'ran')).toBe('ran');
  });
});

describe('WorldMachineSession idle and shutdown during a build (spec v2a section 5)', () => {
  it('does not idle-quit while a full build runs, and quits once it ended', async () => {
    const { session: s, record } = session({ FAKE_WM_BUILD_MS: '700' }, { idleTimeoutMs: 200 });
    await s.ensureRunning();
    await s.executeOne('build start');
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(record.lines()).not.toContain('system quit force');
    await waitUntil(() => record.lines().includes('system quit force'));
    expect(s.buildTracker()).toBeUndefined();
  });

  it('stops a running build before it closes the project on shutdown', async () => {
    const { session: s, record } = session({ FAKE_WM_BUILD_MS: '60000' });
    await s.ensureRunning();
    await s.executeOne('build start');
    await s.shutdown();
    const lines = record.lines();
    expect(lines).toContain('build stop');
    expect(lines.indexOf('build stop')).toBeLessThan(lines.indexOf('project close force'));
    expect(lines.indexOf('project close force')).toBeLessThan(lines.indexOf('system quit force'));
  });

  it('waits at most half the grace for a build that does not stop', async () => {
    // The fake neither stops the build nor quits in time, so each half of the 2 s grace is spent in full: 1 s waiting
    // for the build's end, then the 1 s left for the quit before the kill (decision D5).
    const { session: s, record } = session({
      FAKE_WM_BUILD_MS: '60000',
      FAKE_WM_SILENT_ON: 'build stop',
      FAKE_WM_QUIT_DELAY_MS: '10000',
    });
    await s.ensureRunning();
    await s.executeOne('build start');
    const started = Date.now();
    const stopping = s.shutdown({ drainMs: 0, graceMs: 2_000, termMs: 0 });
    await waitUntil(() => record.lines().includes('project close force'));
    const closedAfter = Date.now() - started;
    await stopping;
    const total = Date.now() - started;
    const lines = record.lines();
    expect(lines).toContain('build stop');
    expect(lines.indexOf('build stop')).toBeLessThan(lines.indexOf('project close force'));
    // Half the grace, not all of it, before the close; then only the remaining grace for the quit.
    expect(closedAfter).toBeGreaterThanOrEqual(900);
    expect(closedAfter).toBeLessThan(1_600);
    expect(total).toBeGreaterThanOrEqual(1_900);
    expect(total).toBeLessThan(2_600);
  });

  it('stops a build whose start is still waiting for its opening events on shutdown (SIGNAL_BUDGET)', async () => {
    const { session: s, record } = session({ FAKE_WM_BUILD_MS: '60000', FAKE_WM_START_DELAY_MS: '500' });
    await s.ensureRunning();
    s.buildTracker()?.expect('full');
    await s.executeOne('build start');
    expect(s.buildTracker()?.running).toBe(false);
    expect(s.buildTracker()?.pending).toBe('full');
    await s.shutdown({ drainMs: 0, graceMs: 500, termMs: 0 });
    const lines = record.lines();
    expect(lines).toContain('build stop');
    expect(lines.indexOf('build stop')).toBeLessThan(lines.indexOf('project close force'));
  });

  it('logs a warning when the build does not end within half the grace on shutdown (Minor 6)', async () => {
    const { session: s, logger } = session({ FAKE_WM_BUILD_MS: '60000', FAKE_WM_SILENT_ON: 'build stop' });
    await s.ensureRunning();
    await s.executeOne('build start');
    await s.shutdown({ drainMs: 0, graceMs: 400, termMs: 0 });
    expect(logger.lines).toContain(
      'warn: The build did not end within 200 ms of build stop; quitting World Machine anyway',
    );
  });

  it('logs no warning when the build ends after build stop on shutdown', async () => {
    const { session: s, logger } = session({ FAKE_WM_BUILD_MS: '60000' });
    await s.ensureRunning();
    await s.executeOne('build start');
    await s.shutdown();
    expect(logger.lines.filter((line) => line.startsWith('warn:'))).toEqual([]);
  });

  it('sends no build stop on shutdown without a running build', async () => {
    const { session: s, record } = session({ FAKE_WM_BUILD_MS: '50' });
    await s.ensureRunning();
    await s.executeOne('build start');
    await s.buildTracker()?.ended(2_000);
    await s.shutdown();
    expect(record.lines()).not.toContain('build stop');
  });
});
