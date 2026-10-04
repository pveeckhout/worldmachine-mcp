import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FsPathPolicy } from '../../../../src/adapter/out/fs/path-policy.js';
import { WorldMachineProcess } from '../../../../src/adapter/out/worldmachine/world-machine-process.js';
import {
  type SessionOptions,
  WorldMachineSession,
} from '../../../../src/adapter/out/worldmachine/world-machine-session.js';
import type { WorldMachineError } from '../../../../src/domain/errors.js';
import { captureLogger, FAKE_WM, fakeEnv, recorder, waitUntil } from '../../../support/fake-wm.js';

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
    startProcess: (bin, signal) =>
      WorldMachineProcess.start({ bin, readyTimeoutMs: 5_000, logger, env, signal }),
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
        startProcess: (bin) =>
          WorldMachineProcess.start({
            bin,
            readyTimeoutMs: 5_000,
            logger,
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
    expect(s.status().session).toEqual({ state: 'notRunning' });
  });

  it('cancels a start that is still waiting for readiness when shut down', async () => {
    const { session: s, record } = session({ FAKE_WM_STARTUP: 'silent' });
    const starting = failure(s.ensureRunning());
    await waitUntil(() => record.lines().includes('START'));
    await s.shutdown();
    expect((await starting).code).toBe('START_FAILED');
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
    expect((await failure(s.ensureRunning())).code).toBe('START_FAILED');
  });
});
