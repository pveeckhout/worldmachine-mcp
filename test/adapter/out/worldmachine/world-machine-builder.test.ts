import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FsPathPolicy } from '../../../../src/adapter/out/fs/path-policy.js';
import {
  type BuilderOptions,
  WorldMachineBuilder,
} from '../../../../src/adapter/out/worldmachine/world-machine-builder.js';
import { WorldMachineProcess } from '../../../../src/adapter/out/worldmachine/world-machine-process.js';
import { WorldMachineSession } from '../../../../src/adapter/out/worldmachine/world-machine-session.js';
import { GROUP_BUILD_NEEDS_GROUP } from '../../../../src/application/port/out/build-port.js';
import type { WorldMachineError } from '../../../../src/domain/errors.js';
import { captureLogger, FAKE_WM, fakeEnv, recorder, waitUntil } from '../../../support/fake-wm.js';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'builder-')));
const sessions: WorldMachineSession[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.shutdown()));
});

function builder(extra: Record<string, string> = {}, options: BuilderOptions = {}) {
  const record = recorder();
  const logger = captureLogger();
  const env = fakeEnv({ FAKE_WM_RECORD: record.path, ...extra });
  const session = new WorldMachineSession({
    executable: FAKE_WM,
    defaultProject: undefined,
    pathPolicy: new FsPathPolicy([root]),
    commandTimeoutMs: 2_000,
    idleTimeoutMs: 0,
    logger,
    startProcess: (bin, signal, onSpawn) =>
      WorldMachineProcess.start({ bin, readyTimeoutMs: 5_000, logger, env, signal, onSpawn }),
  });
  sessions.push(session);
  return { build: new WorldMachineBuilder(session, { pollMs: 50, ...options }), session, record };
}

async function failure(promise: Promise<unknown>): Promise<WorldMachineError> {
  try {
    await promise;
  } catch (error) {
    return error as WorldMachineError;
  }
  throw new Error('expected rejection');
}

// raw/v2b-groups.txt l.16-24.
const TERRAIN = { index: 0, name: 'Create your Terrain', deviceCount: 6 };

describe('WorldMachineBuilder group builds (spec v2b sections 3 and 5)', () => {
  it('starts a group build by #<index>, tracks it as a full run, and waits for its late line', async () => {
    const { build, record } = builder({ FAKE_WM_BUILD_MS: '200' });
    await build.start('group', TERRAIN);
    expect(record.lines()).toContain('group build #0');
    expect(build.current()).toMatchObject({ mode: 'full', startedBy: 'server', state: 'running' });
    expect(await build.waitForEnd('group', 5_000)).toBe(true);
    expect(build.current()).toBeUndefined();
  });

  it('fails at once with UNEXPECTED_OUTPUT when the start frame holds a line, and forgets the expected start', async () => {
    const { build, session } = builder({}, { confirmMs: 5_000 });
    const started = Date.now();
    const error = await failure(
      build.start('group', { index: 3, name: 'Welcome to World Machine!', deviceCount: 0 }),
    );
    expect(error.code).toBe('UNEXPECTED_OUTPUT');
    expect(error.worldMachineMessage).toBe("Group 'Welcome to World Machine!' contains no devices.");
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(session.buildTracker()?.pending).toBeUndefined();
  });

  it("reports World Machine's Error: line for a group it does not have as WM_COMMAND_FAILED", async () => {
    const { build } = builder();
    const error = await failure(build.start('group', { index: 9, name: 'Gone', deviceCount: 1 }));
    expect(error.code).toBe('WM_COMMAND_FAILED');
    expect(error.worldMachineMessage).toBe('Error: Error: Invalid group index: #9 (valid range: #0 - #4)');
  });

  it('refuses mode group without a group and sends nothing', async () => {
    const { build, record } = builder();
    expect(await failure(build.start('group'))).toMatchObject({
      code: 'REFUSED',
      // Final review F4: the same message as the service's refusal.
      message: GROUP_BUILD_NEEDS_GROUP,
    });
    expect(record.lines()).toEqual([]);
  });

  it('tracks a group build started in the World Machine window until its late line (spec v2b section 5)', async () => {
    const { build, session } = builder({
      FAKE_WM_BUILD_MS: '300',
      FAKE_WM_GUI_BUILD: 'group',
      FAKE_WM_GUI_BUILD_ON: 'build status',
    });
    await session.ensureRunning();
    expect(await build.previewRunning()).toBe(false);
    expect(build.current()).toMatchObject({ mode: 'full', startedBy: 'world-machine', state: 'running' });
    expect(await build.waitForEnd('full', 5_000)).toBe(true);
    expect(build.current()).toBeUndefined();
  });
});

describe('WorldMachineBuilder (spec v2a section 5)', () => {
  it('starts a full build, reports it as current, and waits for its end', async () => {
    const { build } = builder({ FAKE_WM_BUILD_MS: '300' });
    await build.start('full');
    expect(build.current()).toMatchObject({ mode: 'full', startedBy: 'server', state: 'running' });
    expect(await build.waitForEnd('full', 5_000)).toBe(true);
    expect(build.current()).toBeUndefined();
  });

  it('starts a tiled build and waits for its end (fact 48)', async () => {
    const { build, record } = builder({ FAKE_WM_BUILD_MS: '200' });
    await build.start('tiled');
    expect(record.lines()).toContain('build start tiled');
    expect(build.current()).toMatchObject({ mode: 'tiled', startedBy: 'server' });
    expect(await build.waitForEnd('tiled', 5_000)).toBe(true);
  });

  it('confirms a preview by its line and polls build status until it ends (fact 42)', async () => {
    const { build, record } = builder({ FAKE_WM_PREVIEW_MS: '300' });
    await build.start('preview');
    expect(build.current()).toBeUndefined();
    expect(await build.previewRunning()).toBe(true);
    expect(await build.waitForEnd('preview', 5_000)).toBe(true);
    expect(record.lines().filter((line) => line === 'build status').length).toBeGreaterThan(1);
  });

  it('fails with UNEXPECTED_OUTPUT when a preview is not confirmed', async () => {
    const { build } = builder({ FAKE_WM_SILENT_ON: 'build preview' });
    expect((await failure(build.start('preview'))).code).toBe('UNEXPECTED_OUTPUT');
  });

  it('fails with UNEXPECTED_OUTPUT when no start event arrives in time, and forgets the expected start', async () => {
    const { build, session } = builder({ FAKE_WM_SILENT_ON: 'build start' }, { confirmMs: 200 });
    const error = await failure(build.start('full'));
    expect(error).toMatchObject({
      code: 'UNEXPECTED_OUTPUT',
      message: 'World Machine did not report the start of the full build within 200 ms',
    });
    session.buildTracker()?.apply('starting');
    expect(build.current()?.startedBy).toBe('world-machine');
  });

  it('stops a full build, confirmed by Stop requested. (fact 46)', async () => {
    const { build } = builder({ FAKE_WM_BUILD_MS: '60000' });
    await build.start('full');
    await build.stop();
    expect(await build.waitForEnd('full', 2_000)).toBe(true);
  });

  it('fails with UNEXPECTED_OUTPUT when build stop is not confirmed', async () => {
    const { build } = builder({ FAKE_WM_SILENT_ON: 'build stop' });
    expect((await failure(build.stop())).code).toBe('UNEXPECTED_OUTPUT');
  });

  it('returns false when the wait bound passes or the signal aborts, and the build keeps running', async () => {
    const { build } = builder({ FAKE_WM_BUILD_MS: '60000' });
    await build.start('full');
    expect(await build.waitForEnd('full', 100)).toBe(false);
    const abort = new AbortController();
    const waiting = build.waitForEnd('full', 60_000, abort.signal);
    abort.abort();
    expect(await waiting).toBe(false);
    expect(build.current()?.mode).toBe('full');
  });

  it('fails the wait with CRASHED when World Machine exits during a build (spec v2a section 7)', async () => {
    const { build, record } = builder({ FAKE_WM_BUILD_MS: '60000' });
    await build.start('full');
    const waiting = failure(build.waitForEnd('full', 60_000));
    for (const pid of record.pids()) process.kill(pid, 'SIGKILL');
    expect(await waiting).toMatchObject({
      code: 'CRASHED',
      message: 'World Machine exited during the build',
    });
  });

  it('fails a preview wait with CRASHED when World Machine restarted during it, though the new one is ready', async () => {
    const { build, session, record } = builder({ FAKE_WM_PREVIEW_MS: '60000' }, { pollMs: 2_000 });
    await build.start('preview');
    const waiting = failure(build.waitForEnd('preview', 30_000));
    await waitUntil(() => record.lines().includes('build status'));
    // The first poll has its answer and the wait pauses until the next one.
    await new Promise((resolve) => setTimeout(resolve, 300));
    for (const pid of record.pids()) process.kill(pid, 'SIGKILL');
    await waitUntil(() => session.status().session.state === 'unhealthy');
    // Another call starts World Machine again before the next poll; its status reads `No build running.`.
    await session.ensureRunning();
    expect(await waiting).toMatchObject({
      code: 'CRASHED',
      message: 'World Machine exited during the build',
    });
  });

  it('fails the wait with SHUTTING_DOWN when the server stops during a build', async () => {
    const { build, session } = builder({ FAKE_WM_BUILD_MS: '60000', FAKE_WM_SILENT_ON: 'build stop' });
    await build.start('full');
    const waiting = failure(build.waitForEnd('full', 60_000));
    await session.shutdown({ drainMs: 0, graceMs: 200, termMs: 0 });
    expect((await waiting).code).toBe('SHUTTING_DOWN');
  });

  it("fails the wait with SHUTTING_DOWN when the shutdown's own build stop ends the build (decision D14)", async () => {
    const { build, session, record } = builder({ FAKE_WM_BUILD_MS: '60000' });
    await build.start('full');
    const waiting = failure(build.waitForEnd('full', 60_000));
    await session.shutdown({ drainMs: 0, graceMs: 2_000, termMs: 0 });
    expect(record.lines()).toContain('build stop');
    expect((await waiting).code).toBe('SHUTTING_DOWN');
  });

  it('waits for a pending start until its delayed opening event arrives', async () => {
    const { build, session } = builder({ FAKE_WM_BUILD_MS: '60000', FAKE_WM_START_DELAY_MS: '300' });
    await build.awaitStart();
    const starting = build.start('full');
    await waitUntil(() => session.buildTracker()?.pending === 'full');
    expect(build.current()).toBeUndefined();
    await build.awaitStart();
    expect(build.current()).toMatchObject({ mode: 'full', startedBy: 'server' });
    await starting;
  });

  it('waits for a slow start beyond its own confirmation bound (spec v2a section 4)', async () => {
    const { build, session } = builder(
      { FAKE_WM_BUILD_MS: '60000', FAKE_WM_DELAY_ON: 'build start', FAKE_WM_DELAY_MS: '600' },
      { confirmMs: 200 },
    );
    const starting = build.start('full');
    await waitUntil(() => session.buildTracker()?.pending === 'full');
    await build.awaitStart();
    expect(build.current()).toMatchObject({ mode: 'full', startedBy: 'server' });
    await starting;
  });

  it('fails a start and a wait for it with SHUTTING_DOWN when the server stops meanwhile (decision D14)', async () => {
    const { build, session } = builder({ FAKE_WM_BUILD_MS: '60000', FAKE_WM_START_DELAY_MS: '1500' });
    const starting = failure(build.start('full'));
    await waitUntil(() => session.buildTracker()?.pending === 'full');
    const waiting = failure(build.awaitStart());
    await session.shutdown();
    expect((await starting).code).toBe('SHUTTING_DOWN');
    expect((await waiting).code).toBe('SHUTTING_DOWN');
  });

  it('reports a tiled build started in the World Machine window as unknown and stops it (assumption A1)', async () => {
    const { build, session } = builder({
      FAKE_WM_BUILD_MS: '60000',
      FAKE_WM_GUI_BUILD: 'tiled',
      FAKE_WM_GUI_BUILD_ON: 'build status',
    });
    await session.ensureRunning();
    expect(await build.previewRunning()).toBe(false);
    expect(build.current()).toMatchObject({ mode: 'unknown', startedBy: 'world-machine', state: 'running' });
    await build.stop();
    expect(await build.waitForEnd('unknown', 2_000)).toBe(true);
    expect(build.current()).toBeUndefined();
  });

  it('forgets a running run on request, so exclusive actions run again', async () => {
    const { build, session } = builder({
      FAKE_WM_BUILD_MS: '60000',
      FAKE_WM_GUI_BUILD: 'full',
      FAKE_WM_GUI_BUILD_ON: 'build status',
    });
    await session.ensureRunning();
    await build.previewRunning();
    expect(build.current()).toMatchObject({ mode: 'full', startedBy: 'world-machine' });
    build.forgetRun();
    expect(build.current()).toBeUndefined();
    expect(await session.exclusive(async () => 'ran')).toBe('ran');
  });

  it('reports no preview without launching World Machine (spec v2a section 4)', async () => {
    const { build, record } = builder();
    expect(await build.previewRunning()).toBe(false);
    expect(build.current()).toBeUndefined();
    expect(record.lines()).toEqual([]);
  });

  it('sees the end of a build that arrives inside another command frame (fact 47)', async () => {
    const { build, session } = builder({ FAKE_WM_BUILD_MS: '60000', FAKE_WM_BUILD_END_ON: 'build status' });
    await build.start('full');
    expect(await build.previewRunning()).toBe(false);
    expect(build.current()).toBeUndefined();
    await waitUntil(() => session.buildTracker()?.running === false);
  });
});
