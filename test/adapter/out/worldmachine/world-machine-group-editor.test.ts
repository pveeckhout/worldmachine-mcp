import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FsPathPolicy } from '../../../../src/adapter/out/fs/path-policy.js';
import { WorldMachineGroupEditor } from '../../../../src/adapter/out/worldmachine/world-machine-group-editor.js';
import { WorldMachineProcess } from '../../../../src/adapter/out/worldmachine/world-machine-process.js';
import { WorldMachineSession } from '../../../../src/adapter/out/worldmachine/world-machine-session.js';
import { captureLogger, FAKE_WM, fakeEnv, recorder } from '../../../support/fake-wm.js';
import { scriptedSession } from '../../../support/scripted-session.js';
import { rawFrame } from './parsers/fixture.js';

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
    pathPolicy: new FsPathPolicy([mkdtempSync(join(tmpdir(), 'group-editor-'))]),
    commandTimeoutMs: 2_000,
    idleTimeoutMs: 0,
    logger,
    startProcess: (bin, signal, onSpawn) =>
      WorldMachineProcess.start({ bin, readyTimeoutMs: 5_000, logger, env, signal, onSpawn }),
  });
  sessions.push(session);
  return { session, editor: new WorldMachineGroupEditor(session), record };
}

/** Console lines sent after the session's start-up commands, without sentinels and nudges. */
function sent(record: ReturnType<typeof recorder>): string[] {
  const lines = record.lines().filter((line) => !line.startsWith('__end_') && line !== '');
  return lines.slice(lines.indexOf('project new default force') + 1);
}

// raw/v2b-groups.txt l.16-24.
const LIST = rawFrame('v2b-groups.txt', 'group list');
const TERRAIN = { index: 0, name: 'Create your Terrain', deviceCount: 6 };
const WELCOME = { index: 3, name: 'Welcome to World Machine!', deviceCount: 0 };

describe('WorldMachineGroupEditor.list', () => {
  it('lists the groups, and filtered groups with the unfiltered total in the header (fact 63)', async () => {
    const s = scriptedSession({
      'group list': [{ output: LIST }],
      'group list Export': [{ output: rawFrame('v2b-groups.txt', 'group list Export') }],
      'group list nomatch': [{ output: rawFrame('v2b-groups.txt', 'group list nomatch') }],
    });
    const groups = new WorldMachineGroupEditor(s.session);
    expect(await groups.list()).toHaveLength(5);
    expect(await groups.list('Export')).toEqual([{ index: 1, name: 'Export Basics', deviceCount: 4 }]);
    expect(await groups.list('nomatch')).toEqual([]);
  });

  it('refuses a filter the command builder refuses, before anything is sent', async () => {
    const s = scriptedSession({});
    await expect(new WorldMachineGroupEditor(s.session).list("it's")).rejects.toMatchObject({
      code: 'REFUSED',
    });
    expect(s.batches).toEqual([]);
  });
});

describe('WorldMachineGroupEditor.setEnabled', () => {
  it('resolves a name in any case, sends #<index>, and marks the session unsaved (fact 64)', async () => {
    const s = scriptedSession({
      'group list': [{ output: LIST }],
      'group disable #0': [{ output: ["Disabled 6 device(s) in group 'Create your Terrain'"] }],
    });
    expect(await new WorldMachineGroupEditor(s.session).setEnabled('create your TERRAIN', false)).toEqual(
      TERRAIN,
    );
    expect(s.batches).toEqual([['group list'], ['group disable #0']]);
    expect(s.dirtyMarks()).toBe(1);
  });

  it('enables a group by #<index> with a name that holds & (l.227-228)', async () => {
    const s = scriptedSession({
      'group list': [{ output: LIST }],
      'group enable #2': [{ output: ["Enabled 5 device(s) in group 'Texture & View'"] }],
    });
    expect(await new WorldMachineGroupEditor(s.session).setEnabled('#2', true)).toEqual({
      index: 2,
      name: 'Texture & View',
      deviceCount: 5,
    });
  });

  it('returns a group without devices unchanged and leaves the session alone (fact 65)', async () => {
    const s = scriptedSession({
      'group list': [{ output: LIST }],
      'group disable #3': [{ output: ["Group 'Welcome to World Machine!' contains no devices."] }],
    });
    expect(
      await new WorldMachineGroupEditor(s.session).setEnabled('Welcome to World Machine!', false),
    ).toEqual(WELCOME);
    expect(s.dirtyMarks()).toBe(0);
  });

  it.each([
    ['a missing name', 'missing', "No group 'missing' in the current project; see list_groups"],
    ['an index out of range', '#5', 'No group #5 in the current project; see list_groups'],
    [
      'a name with padding',
      'Create your Terrain ',
      "No group 'Create your Terrain ' in the current project; see list_groups",
    ],
  ])('refuses %s after its own list, sending nothing else', async (_label, reference, message) => {
    const s = scriptedSession({ 'group list': [{ output: LIST }] });
    await expect(new WorldMachineGroupEditor(s.session).setEnabled(reference, true)).rejects.toMatchObject({
      code: 'REFUSED',
      message,
    });
    expect(s.batches).toEqual([['group list']]);
  });

  it('refuses a name two groups share in any case (assumption B4)', async () => {
    const s = scriptedSession({
      'group list': [
        {
          output: [
            'Groups (2 total):',
            '  [#0] Rocks                    (1 device)',
            '  [#1] rocks                    (2 devices)',
          ],
        },
      ],
    });
    await expect(new WorldMachineGroupEditor(s.session).setEnabled('ROCKS', true)).rejects.toMatchObject({
      code: 'REFUSED',
      message: "The group name 'ROCKS' matches #0, #1; use #<index>",
    });
    expect(s.batches).toEqual([['group list']]);
  });

  it.each([
    ['the other verb', ["Enabled 6 device(s) in group 'Create your Terrain'"]],
    ['another count', ["Disabled 5 device(s) in group 'Create your Terrain'"]],
    ['another group', ["Disabled 6 device(s) in group 'Export Basics'"]],
    ['an extra line', ["Disabled 6 device(s) in group 'Create your Terrain'", 'Something else']],
    ['no answer', []],
  ])('reports %s as UNEXPECTED_OUTPUT, with the session marked unsaved', async (_label, output) => {
    const s = scriptedSession({ 'group list': [{ output: LIST }], 'group disable #0': [{ output }] });
    await expect(new WorldMachineGroupEditor(s.session).setEnabled('#0', false)).rejects.toMatchObject({
      code: 'UNEXPECTED_OUTPUT',
    });
    expect(s.dirtyMarks()).toBe(1);
  });

  it('reports the empty-group answer for a group listed with devices as UNEXPECTED_OUTPUT, leaving the session alone', async () => {
    const s = scriptedSession({
      'group list': [{ output: LIST }],
      'group disable #0': [{ output: ["Group 'Create your Terrain' contains no devices."] }],
    });
    await expect(new WorldMachineGroupEditor(s.session).setEnabled('#0', false)).rejects.toMatchObject({
      code: 'UNEXPECTED_OUTPUT',
    });
    expect(s.dirtyMarks()).toBe(0);
  });

  it('reports a change answer for a group listed without devices as UNEXPECTED_OUTPUT', async () => {
    const s = scriptedSession({
      'group list': [{ output: LIST }],
      'group enable #3': [{ output: ["Enabled 1 device(s) in group 'Welcome to World Machine!'"] }],
    });
    await expect(new WorldMachineGroupEditor(s.session).setEnabled('#3', true)).rejects.toMatchObject({
      code: 'UNEXPECTED_OUTPUT',
    });
    expect(s.dirtyMarks()).toBe(1);
  });

  it("reports World Machine's Error: line as WM_COMMAND_FAILED and leaves the session alone", async () => {
    const s = scriptedSession({
      'group list': [{ output: LIST }],
      // Assumed: the group went away between the list and the command; the error of raw/v2b-groups.txt l.254-255.
      'group enable #4': [{ errors: ['Error: Error: Invalid group index: #4 (valid range: #0 - #3)'] }],
    });
    await expect(new WorldMachineGroupEditor(s.session).setEnabled('#4', true)).rejects.toMatchObject({
      code: 'WM_COMMAND_FAILED',
    });
    expect(s.dirtyMarks()).toBe(0);
  });
});

describe('WorldMachineGroupEditor over the fake World Machine', () => {
  it('disables and enables the members of a group by its index (spec v2b section 4, fact 64)', async () => {
    const { session, editor: e, record } = editor();
    expect(await e.resolve('Create Your Terrain')).toEqual(TERRAIN);
    expect(await e.setEnabled('Create your Terrain', false)).toEqual(TERRAIN);
    expect(session.status().session.dirty).toBe(true);
    const disabled = (await session.executeOne('device list')).output.filter((row) =>
      row.endsWith('[disabled]'),
    );
    expect(disabled).toHaveLength(6);
    expect(await e.setEnabled('#0', true)).toEqual(TERRAIN);
    expect((await session.executeOne('device list')).output.some((row) => row.endsWith('[disabled]'))).toBe(
      false,
    );
    expect(sent(record).filter((line) => line.startsWith('group '))).toEqual([
      'group list',
      'group list',
      'group disable #0',
      'group list',
      'group enable #0',
    ]);
  });
});
