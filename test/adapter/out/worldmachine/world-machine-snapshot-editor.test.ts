import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FsPathPolicy } from '../../../../src/adapter/out/fs/path-policy.js';
import { WorldMachineProcess } from '../../../../src/adapter/out/worldmachine/world-machine-process.js';
import { WorldMachineSession } from '../../../../src/adapter/out/worldmachine/world-machine-session.js';
import { WorldMachineSnapshotEditor } from '../../../../src/adapter/out/worldmachine/world-machine-snapshot-editor.js';
import { captureLogger, FAKE_WM, fakeEnv, recorder } from '../../../support/fake-wm.js';
import { scriptedSession } from '../../../support/scripted-session.js';

const sessions: WorldMachineSession[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.shutdown()));
});

function editor() {
  const record = recorder();
  const logger = captureLogger();
  const env = fakeEnv({ FAKE_WM_RECORD: record.path });
  const session = new WorldMachineSession({
    executable: FAKE_WM,
    defaultProject: undefined,
    pathPolicy: new FsPathPolicy([mkdtempSync(join(tmpdir(), 'snapshot-editor-'))]),
    commandTimeoutMs: 2_000,
    idleTimeoutMs: 0,
    logger,
    startProcess: (bin, signal, onSpawn) =>
      WorldMachineProcess.start({ bin, readyTimeoutMs: 5_000, logger, env, signal, onSpawn }),
  });
  sessions.push(session);
  return { session, editor: new WorldMachineSnapshotEditor(session), record };
}

/** Console lines sent after the session's start-up commands, without sentinels and nudges. */
function sent(record: ReturnType<typeof recorder>): string[] {
  const lines = record.lines().filter((line) => !line.startsWith('__end_') && line !== '');
  return lines.slice(lines.indexOf('project new default force') + 1);
}

const TIME = '2026-10-06 11:09';
/** A `snapshot list` answer for these names, as raw/v2b-snapshots.txt l.92-98 prints it. */
const listing = (...names: string[]) =>
  names.length === 0
    ? ['No snapshots.']
    : [
        `Snapshots (${names.length} total):`,
        ...names.map((name, index) => `  [#${index}] '${name}' - ${TIME}`),
      ];
const snapshot = (index: number, name: string) => ({ index, name, created: TIME });

describe('WorldMachineSnapshotEditor.create', () => {
  it('creates a snapshot, reads the list back, and marks the session unsaved (facts 58 and 59)', async () => {
    const s = scriptedSession({
      'snapshot list': [{ output: listing('A') }, { output: listing('A', 'B with space') }],
      'snapshot create B with space': [{ output: ["Created snapshot 'B with space'"] }],
    });
    expect(await new WorldMachineSnapshotEditor(s.session).create('B with space')).toEqual(
      snapshot(1, 'B with space'),
    );
    expect(s.batches).toEqual([['snapshot list'], ['snapshot create B with space', 'snapshot list']]);
    expect(s.dirtyMarks()).toBe(1);
  });

  it.each([
    ['an empty name', '', 'must not be empty'],
    ['a name longer than 64 characters', 'x'.repeat(65), 'must not be longer than 64 characters'],
    ['a leading space', ' A', 'must not start or end with whitespace'],
    ['a trailing space', 'A ', 'must not start or end with whitespace'],
    ['a single quote', "it's", "must not contain ', which snapshot list prints around names"],
    ['an index-like name', '#3', 'must not look like a snapshot index (#<n>)'],
    ['a control character', 'a\tb', 'control characters'],
    ['a double quote', 'a"b', 'Quotes and backslashes'],
    ['a backslash', 'a\\b', 'Quotes and backslashes'],
    ['the reserved prefix', '__end_x', 'reserved prefix'],
  ])('refuses %s before anything is sent', async (_label, name, message) => {
    const s = scriptedSession({});
    await expect(new WorldMachineSnapshotEditor(s.session).create(name)).rejects.toMatchObject({
      code: 'REFUSED',
      message: expect.stringContaining(message),
    });
    expect(s.batches).toEqual([]);
  });

  it('refuses a name a snapshot already has, after its own list (spec v2b section 4)', async () => {
    const s = scriptedSession({ 'snapshot list': [{ output: listing('A', 'B') }] });
    await expect(new WorldMachineSnapshotEditor(s.session).create('B')).rejects.toMatchObject({
      code: 'REFUSED',
      message: "Snapshot #1 is already named 'B'; choose another name",
    });
    expect(s.batches).toEqual([['snapshot list']]);
    expect(s.dirtyMarks()).toBe(0);
  });

  it("reports World Machine's Error: line as WM_COMMAND_FAILED and leaves the session alone", async () => {
    const s = scriptedSession({
      'snapshot list': [{ output: listing() }, { output: listing() }],
      // raw/v2b-snapshots.txt l.86-87, as an answer to a create.
      'snapshot create A': [{ errors: ['Error: Error: Usage: snapshot create <name>'] }],
    });
    await expect(new WorldMachineSnapshotEditor(s.session).create('A')).rejects.toMatchObject({
      code: 'WM_COMMAND_FAILED',
      worldMachineMessage: 'Error: Error: Usage: snapshot create <name>',
    });
    expect(s.dirtyMarks()).toBe(0);
  });

  it.each([
    ['a missing confirmation', [], listing('A'), 'UNEXPECTED_OUTPUT'],
    ['a confirmation for another name', ["Created snapshot 'B'"], listing('A'), 'UNEXPECTED_OUTPUT'],
    ['an extra line', ["Created snapshot 'A'", 'Something else'], listing('A'), 'UNEXPECTED_OUTPUT'],
    ['a list that does not parse', ["Created snapshot 'A'"], ['Snapshots (1 total):'], 'UNEXPECTED_OUTPUT'],
    // Spec v2b section 6: confirmed, but the read-back does not show the change.
    ['a list without the new snapshot', ["Created snapshot 'A'"], listing(), 'WM_COMMAND_FAILED'],
    ['a list with another newest snapshot', ["Created snapshot 'A'"], listing('B'), 'WM_COMMAND_FAILED'],
  ])('reports %s as %s, with the session marked unsaved', async (_label, confirmation, after, code) => {
    const s = scriptedSession({
      'snapshot list': [{ output: listing() }, { output: after }],
      'snapshot create A': [{ output: confirmation }],
    });
    await expect(new WorldMachineSnapshotEditor(s.session).create('A')).rejects.toMatchObject({ code });
    expect(s.dirtyMarks()).toBe(1);
  });
});

describe('WorldMachineSnapshotEditor.restore', () => {
  it('resolves an exact name to its index and sends #<index> (spec v2b section 4, fact 60)', async () => {
    const s = scriptedSession({
      'snapshot list': [{ output: listing('A', 'a') }],
      'snapshot restore #1': [{ output: ["Restored snapshot [#1] 'a'"] }],
    });
    expect(await new WorldMachineSnapshotEditor(s.session).restore('a')).toEqual(snapshot(1, 'a'));
    expect(s.batches).toEqual([['snapshot list'], ['snapshot restore #1']]);
    expect(s.dirtyMarks()).toBe(1);
  });

  it('resolves a listed name that ends in spaces by that exact name (final review F1)', async () => {
    const s = scriptedSession({
      'snapshot list': [{ output: listing('A', 'A  ') }],
      'snapshot restore #1': [{ output: ["Restored snapshot [#1] 'A  '"] }],
    });
    expect(await new WorldMachineSnapshotEditor(s.session).restore('A  ')).toEqual(snapshot(1, 'A  '));
    expect(s.batches).toEqual([['snapshot list'], ['snapshot restore #1']]);
  });

  it.each([
    ['a name two snapshots have', 'A', "The snapshot name 'A' matches #0, #2; use #<index>"],
    ['a missing name', 'missing', "No snapshot 'missing' in the current project; see list_snapshots"],
    ['an index out of range', '#3', 'No snapshot #3 in the current project; see list_snapshots'],
  ])('refuses %s after its own list, sending nothing else', async (_label, reference, message) => {
    const s = scriptedSession({ 'snapshot list': [{ output: listing('A', 'B', 'A') }] });
    await expect(new WorldMachineSnapshotEditor(s.session).restore(reference)).rejects.toMatchObject({
      code: 'REFUSED',
      message,
    });
    expect(s.batches).toEqual([['snapshot list']]);
  });

  it.each([
    ['another index', "Restored snapshot [#0] 'B'"],
    ['another name', "Restored snapshot [#1] 'A'"],
    ['no confirmation', undefined],
  ])(
    'reports a confirmation naming %s as UNEXPECTED_OUTPUT, with the session marked unsaved',
    async (_label, line) => {
      const s = scriptedSession({
        'snapshot list': [{ output: listing('A', 'B') }],
        'snapshot restore #1': [{ output: line === undefined ? [] : [line] }],
      });
      await expect(new WorldMachineSnapshotEditor(s.session).restore('B')).rejects.toMatchObject({
        code: 'UNEXPECTED_OUTPUT',
      });
      expect(s.dirtyMarks()).toBe(1);
    },
  );

  it("reports World Machine's Error: line as WM_COMMAND_FAILED and leaves the session alone", async () => {
    const s = scriptedSession({
      'snapshot list': [{ output: listing('A') }],
      // Assumed: the snapshot went away between the list and the restore; the error form of raw/v2b-snapshots.txt
      // l.186-187.
      'snapshot restore #0': [
        { errors: ['Error: Error: Invalid snapshot index: #0 (valid range: #0 - #-1)'] },
      ],
    });
    await expect(new WorldMachineSnapshotEditor(s.session).restore('#0')).rejects.toMatchObject({
      code: 'WM_COMMAND_FAILED',
    });
    expect(s.dirtyMarks()).toBe(0);
  });
});

describe('WorldMachineSnapshotEditor.remove', () => {
  it('deletes by name, checks that the others shifted down, and returns them (fact 61)', async () => {
    const s = scriptedSession({
      'snapshot list': [{ output: listing('A', 'B with space', 'C') }, { output: listing('A', 'C') }],
      'snapshot delete #1': [{ output: ["Deleted snapshot [#1] 'B with space'"] }],
    });
    expect(await new WorldMachineSnapshotEditor(s.session).remove('B with space')).toEqual({
      deleted: snapshot(1, 'B with space'),
      remaining: [snapshot(0, 'A'), snapshot(1, 'C')],
    });
    expect(s.batches).toEqual([['snapshot list'], ['snapshot delete #1', 'snapshot list']]);
    expect(s.dirtyMarks()).toBe(1);
  });

  it.each([
    ['a list that still shows it', listing('A', 'B', 'C')],
    ['a list without another snapshot', listing('B', 'C')],
    ['an empty list', listing()],
  ])('reports %s as WM_COMMAND_FAILED, with the session marked unsaved', async (_label, after) => {
    const s = scriptedSession({
      'snapshot list': [{ output: listing('A', 'B', 'C') }, { output: after }],
      'snapshot delete #1': [{ output: ["Deleted snapshot [#1] 'B'"] }],
    });
    await expect(new WorldMachineSnapshotEditor(s.session).remove('#1')).rejects.toMatchObject({
      code: 'WM_COMMAND_FAILED',
    });
    expect(s.dirtyMarks()).toBe(1);
  });

  it.each([
    ['a missing confirmation', [], listing('A', 'C')],
    ['a confirmation for another index', ["Deleted snapshot [#0] 'B'"], listing('A', 'C')],
    ['a confirmation for another name', ["Deleted snapshot [#1] 'C'"], listing('A', 'C')],
    ['an extra line', ["Deleted snapshot [#1] 'B'", 'Something else'], listing('A', 'C')],
    ['a list after the delete that does not parse', ["Deleted snapshot [#1] 'B'"], ['Snapshots (2 total):']],
  ])(
    'reports %s as UNEXPECTED_OUTPUT, with the session marked unsaved',
    async (_label, confirmation, after) => {
      const s = scriptedSession({
        'snapshot list': [{ output: listing('A', 'B', 'C') }, { output: after }],
        'snapshot delete #1': [{ output: confirmation }],
      });
      await expect(new WorldMachineSnapshotEditor(s.session).remove('#1')).rejects.toMatchObject({
        code: 'UNEXPECTED_OUTPUT',
      });
      expect(s.dirtyMarks()).toBe(1);
    },
  );

  it("reports World Machine's Error: line for a delete as WM_COMMAND_FAILED and leaves the session alone", async () => {
    const s = scriptedSession({
      'snapshot list': [{ output: listing('A', 'B') }, { output: listing('A', 'B') }],
      // Assumed: the snapshot went away between the list and the delete; the error form of raw/v2b-snapshots.txt
      // l.255-256.
      'snapshot delete #1': [{ errors: ['Error: Error: Invalid snapshot index: #1 (valid range: #0 - #0)'] }],
    });
    await expect(new WorldMachineSnapshotEditor(s.session).remove('#1')).rejects.toMatchObject({
      code: 'WM_COMMAND_FAILED',
    });
    expect(s.dirtyMarks()).toBe(0);
  });

  it('refuses a name two snapshots have and sends no delete', async () => {
    const s = scriptedSession({ 'snapshot list': [{ output: listing('A', 'A') }] });
    await expect(new WorldMachineSnapshotEditor(s.session).remove('A')).rejects.toMatchObject({
      code: 'REFUSED',
    });
    expect(s.batches).toEqual([['snapshot list']]);
  });
});

describe('WorldMachineSnapshotEditor over the fake World Machine', () => {
  it('creates, restores, lists, and deletes snapshots, sending #<index> (spec v2b section 4)', async () => {
    const { session, editor: e, record } = editor();
    expect(await e.list()).toEqual([]);
    const created = await e.create('before gradient');
    expect(created).toMatchObject({ index: 0, name: 'before gradient' });
    expect(created.created).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(session.status().session.dirty).toBe(true);
    await session.execute(['device add Gradient']);
    session.bind({ kind: 'fresh' });
    expect(await e.restore('before gradient')).toEqual(created);
    expect(session.status().session.dirty).toBe(true);
    expect((await session.executeOne('device list')).output).not.toContain(
      '  #536   Gradient                ',
    );
    expect(await e.create(`${'x'.repeat(63)}y`)).toMatchObject({ index: 1 });
    expect(await e.remove('#0')).toEqual({
      deleted: created,
      remaining: [{ index: 0, name: `${'x'.repeat(63)}y`, created: expect.any(String) }],
    });
    expect(sent(record).filter((line) => /^snapshot (create|restore|delete)/.test(line))).toEqual([
      'snapshot create before gradient',
      'snapshot restore #0',
      `snapshot create ${'x'.repeat(63)}y`,
      'snapshot delete #0',
    ]);
  });
});
