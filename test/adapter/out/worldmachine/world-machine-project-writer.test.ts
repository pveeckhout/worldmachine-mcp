import { mkdtempSync, realpathSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FsPathPolicy } from '../../../../src/adapter/out/fs/path-policy.js';
import { WorldMachineGraphReader } from '../../../../src/adapter/out/worldmachine/world-machine-graph-reader.js';
import { WorldMachineProcess } from '../../../../src/adapter/out/worldmachine/world-machine-process.js';
import { WorldMachineProjectWriter } from '../../../../src/adapter/out/worldmachine/world-machine-project-writer.js';
import {
  type SessionOptions,
  WorldMachineSession,
} from '../../../../src/adapter/out/worldmachine/world-machine-session.js';
import { captureLogger, FAKE_WM, fakeEnv, recorder } from '../../../support/fake-wm.js';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'writer-')));
const sessions: WorldMachineSession[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((s) => s.shutdown()));
});

function writer(extra: Record<string, string> = {}, overrides: Partial<SessionOptions> = {}) {
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
    ...overrides,
  });
  sessions.push(session);
  return {
    session,
    writer: new WorldMachineProjectWriter(session),
    reader: new WorldMachineGraphReader(session),
    record,
  };
}

describe('WorldMachineProjectWriter', () => {
  it('opens a project with force and binds it', async () => {
    const { session, writer: w, record } = writer();
    const path = join(root, 'a b.tmd');
    writeFileSync(path, 'x');
    await w.openProject(path);
    expect(record.lines()).toContain(`project open ${path} force`);
    expect(session.status().session).toEqual({
      state: 'ready',
      binding: { kind: 'opened', path },
      dirty: false,
    });
  });

  it('reports a failed open and records that the previous project was closed', async () => {
    const { session, writer: w, reader } = writer({ FAKE_WM_OPEN_ERROR: '1' });
    await expect(w.openProject(join(root, 'x.tmd'))).rejects.toMatchObject({
      code: 'WM_COMMAND_FAILED',
      worldMachineMessage: 'Failed to open project.',
    });
    expect(session.status().session.binding).toEqual({ kind: 'fresh' });
    const overview = await reader.inspectProject();
    expect(overview.devices).toEqual([]);
    expect(overview.groups).toEqual([]);
  });

  it('creates a new default project', async () => {
    const { session, writer: w, record } = writer();
    await session.ensureRunning();
    session.markDirty();
    await w.createProject();
    expect(record.lines().filter((l) => l === 'project new default force')).toHaveLength(2);
    expect(session.status().session).toEqual({ state: 'ready', binding: { kind: 'fresh' }, dirty: false });
  });

  it('saves, verifies the file on disk, and binds the saved path', async () => {
    const { session, writer: w } = writer();
    const path = join(root, 'saved.tmd');
    await w.saveProject(path, false);
    expect(statSync(path).isFile()).toBe(true);
    expect(session.status().session).toEqual({
      state: 'ready',
      binding: { kind: 'opened', path },
      dirty: false,
    });
  });

  it('fails when World Machine reports a save but writes nothing', async () => {
    const { session, writer: w } = writer({ FAKE_WM_SAVE_SILENT: '1' });
    await expect(w.saveProject(join(root, 'ghost.tmd'), false)).rejects.toMatchObject({
      code: 'WM_COMMAND_FAILED',
    });
    expect(session.status().session.binding).toEqual({ kind: 'fresh' });
  });

  it('fails when an existing file is not rewritten', async () => {
    const { writer: w } = writer({ FAKE_WM_SAVE_SILENT: '1' });
    const path = join(root, 'stale.tmd');
    writeFileSync(path, 'old');
    utimesSync(path, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
    await expect(w.saveProject(path, true)).rejects.toMatchObject({ code: 'WM_COMMAND_FAILED' });
  });

  it('refuses to replace a file that appeared after authorisation unless replacing is allowed', async () => {
    const { writer: w, record } = writer();
    const path = join(root, 'appeared.tmd');
    writeFileSync(path, 'someone else');
    await expect(w.saveProject(path, false)).rejects.toMatchObject({ code: 'REFUSED' });
    expect(record.lines().some((line) => line.startsWith('project save'))).toBe(false);
  });

  it('refuses a dangling symlink at the target without sending project save', async () => {
    const { writer: w, record } = writer();
    const path = join(root, 'dangling.tmd');
    symlinkSync(join(root, 'does-not-exist.tmd'), path);
    await expect(w.saveProject(path, false)).rejects.toMatchObject({
      code: 'REFUSED',
      message: `${path} already exists. Pass overwrite: true to replace it.`,
    });
    expect(record.lines().some((line) => line.startsWith('project save'))).toBe(false);
  });

  it('refuses when the target cannot be inspected for a reason other than absence', async () => {
    const { writer: w, record } = writer();
    const file = join(root, 'plain-file');
    writeFileSync(file, 'x');
    const path = join(file, 'under-a-file.tmd');
    await expect(w.saveProject(path, false)).rejects.toMatchObject({
      code: 'REFUSED',
      message: `Not a writable .tmd project path inside the allowed roots: ${path}`,
    });
    expect(record.lines().some((line) => line.startsWith('project save'))).toBe(false);
  });

  it('marks the project dirty after undo and redo', async () => {
    const { session, writer: w, record } = writer();
    await w.undo();
    expect(session.status().session.dirty).toBe(true);
    session.bind({ kind: 'fresh' });
    await w.redo();
    expect(session.status().session.dirty).toBe(true);
    expect(record.lines()).toEqual(expect.arrayContaining(['project undo', 'project redo']));
  });
});

describe('WorldMachineProjectWriter without a confirmation line (ruling G1)', () => {
  it('binds fresh and marks dirty after an unconfirmed open', async () => {
    const path = join(root, 'silent open.tmd');
    writeFileSync(path, 'x');
    const { session, writer: w } = writer({ FAKE_WM_SILENT_ON: `project open ${path} force` });
    await session.ensureRunning();
    session.bind({ kind: 'opened', path: join(root, 'previous.tmd') });
    await expect(w.openProject(path)).rejects.toMatchObject({ code: 'UNEXPECTED_OUTPUT' });
    expect(session.status().session).toEqual({ state: 'ready', binding: { kind: 'fresh' }, dirty: true });
  });

  it('binds fresh and marks dirty after an unconfirmed create', async () => {
    // Started on a default project, because the fresh start itself runs `project new default force`.
    const start = join(root, 'start.tmd');
    writeFileSync(start, 'x');
    const { session, writer: w } = writer(
      { FAKE_WM_SILENT_ON: 'project new default force' },
      { defaultProject: start },
    );
    await session.ensureRunning();
    expect(session.status().session.binding).toEqual({ kind: 'opened', path: start });
    await expect(w.createProject()).rejects.toMatchObject({ code: 'UNEXPECTED_OUTPUT' });
    expect(session.status().session).toEqual({ state: 'ready', binding: { kind: 'fresh' }, dirty: true });
  });

  it.each([
    ['undo', 'project undo'],
    ['redo', 'project redo'],
  ] as const)('marks dirty before checking the %s confirmation', async (action, command) => {
    const { session, writer: w } = writer({ FAKE_WM_SILENT_ON: command });
    await session.ensureRunning();
    await expect(w[action]()).rejects.toMatchObject({ code: 'UNEXPECTED_OUTPUT' });
    expect(session.status().session).toEqual({ state: 'ready', binding: { kind: 'fresh' }, dirty: true });
  });

  it.each([
    ['undo', 'project undo'],
    ['redo', 'project redo'],
  ] as const)('does not mark dirty when World Machine rejects %s', async (action, command) => {
    // A stub session: no capture shows `project undo` or `project redo` failing, so the fake has no way to produce
    // an `Error:` line for them without invented output. The error text below is the stub's, not World Machine's.
    let marked = false;
    const session = {
      executeOne: async () => ({ command, output: [], errors: ['Error: Error: stub failure'] }),
      markDirty: () => {
        marked = true;
      },
      bind: () => undefined,
    } as unknown as WorldMachineSession;
    await expect(new WorldMachineProjectWriter(session)[action]()).rejects.toMatchObject({
      code: 'WM_COMMAND_FAILED',
    });
    expect(marked).toBe(false);
  });

  it('keeps a failed open bound fresh and clean', async () => {
    const { session, writer: w } = writer({ FAKE_WM_OPEN_ERROR: '1' });
    await session.ensureRunning();
    session.bind({ kind: 'opened', path: join(root, 'previous.tmd') });
    await expect(w.openProject(join(root, 'x.tmd'))).rejects.toMatchObject({ code: 'WM_COMMAND_FAILED' });
    expect(session.status().session).toEqual({ state: 'ready', binding: { kind: 'fresh' }, dirty: false });
  });
});
