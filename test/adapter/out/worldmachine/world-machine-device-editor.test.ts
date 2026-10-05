import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FsPathPolicy } from '../../../../src/adapter/out/fs/path-policy.js';
import { WorldMachineDeviceEditor } from '../../../../src/adapter/out/worldmachine/world-machine-device-editor.js';
import { WorldMachineProcess } from '../../../../src/adapter/out/worldmachine/world-machine-process.js';
import { WorldMachineSession } from '../../../../src/adapter/out/worldmachine/world-machine-session.js';
import { captureLogger, FAKE_WM, fakeEnv, recorder } from '../../../support/fake-wm.js';
import { scriptedSession } from '../../../support/scripted-session.js';

const sessions: WorldMachineSession[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.shutdown()));
});

function editor(extra: Record<string, string> = {}) {
  const record = recorder();
  const logger = captureLogger();
  const env = fakeEnv({ FAKE_WM_RECORD: record.path, ...extra });
  const session = new WorldMachineSession({
    executable: FAKE_WM,
    defaultProject: undefined,
    pathPolicy: new FsPathPolicy([mkdtempSync(join(tmpdir(), 'device-editor-'))]),
    commandTimeoutMs: 2_000,
    idleTimeoutMs: 0,
    logger,
    startProcess: (bin, signal, onSpawn) =>
      WorldMachineProcess.start({ bin, readyTimeoutMs: 5_000, logger, env, signal, onSpawn }),
  });
  sessions.push(session);
  return { session, editor: new WorldMachineDeviceEditor(session), record };
}

/** Console lines sent after the session's start-up commands, without sentinels. */
function sent(record: ReturnType<typeof recorder>): string[] {
  const lines = record.lines().filter((line) => !line.startsWith('__end_'));
  return lines.slice(lines.indexOf('project new default force') + 1);
}

// The fake's first new id in the sample project (spec fact 30).
const GRADIENT_536 = { id: 536, name: 'Gradient', enabled: true, bypassed: false };
// raw/p2c-edits.txt l.21-25.
const P2C_DEVICES = [
  'Devices (4 total):',
  '  #1     Gradient                ',
  '  #2     Combiner                ',
  '  #3     Height Output           ',
  '  #4     Gradient                ',
];

describe('WorldMachineDeviceEditor.addDevice', () => {
  it('adds a device, finds its id by comparing device lists, and marks the project modified', async () => {
    const { session, editor: e, record } = editor();
    expect(await e.addDevice('Gradient')).toEqual(GRADIENT_536);
    expect(sent(record)).toEqual(['device list', 'device add Gradient', 'device list']);
    expect(session.status().session.dirty).toBe(true);
  });

  it('reports the name World Machine gives, as for File Output (raw/v6b-param-set.txt l.13-14)', async () => {
    expect((await editor().editor.addDevice('File Output')).name).toBe('Height Output');
  });

  it('renames the new device by its id when a name is given', async () => {
    const { editor: e, record } = editor();
    expect(await e.addDevice('Gradient', 'Grad A')).toEqual({
      id: 536,
      name: 'Grad A',
      kind: 'Gradient',
      enabled: true,
      bypassed: false,
    });
    expect(sent(record).slice(3)).toEqual(['device rename #536 Grad A', 'device list']);
  });

  it('refuses a name device list could not read back before World Machine starts', async () => {
    const { editor: e, record } = editor();
    await expect(e.addDevice('Gradient', 'Grad [disabled]')).rejects.toMatchObject({ code: 'REFUSED' });
    expect(record.lines()).toEqual([]);
  });

  it('refuses a type containing a quote before World Machine starts', async () => {
    const { editor: e, record } = editor();
    await expect(e.addDevice('Gra"dient')).rejects.toMatchObject({ code: 'REFUSED' });
    expect(record.lines()).toEqual([]);
  });

  it('reports a missing rename confirmation after the add, with the project modified', async () => {
    const { session, editor: e } = editor({ FAKE_WM_SILENT_ON: 'device rename #536 Grad A' });
    await expect(e.addDevice('Gradient', 'Grad A')).rejects.toMatchObject({
      code: 'UNEXPECTED_OUTPUT',
      message: expect.stringContaining("Added #536 'Gradient', but the rename failed"),
    });
    expect(session.status().session.dirty).toBe(true);
  });

  it("reports an unknown type with World Machine's text and leaves dirty alone (spec fact 32)", async () => {
    const s = scriptedSession({
      // raw/p2c-edits.txt l.21-25: the list before and after is the same.
      'device list': [{ output: P2C_DEVICES }, { output: P2C_DEVICES }],
      // raw/p2c-edits.txt l.17-18.
      'device add NoSuchDeviceType': [
        { errors: ["Error: Error: Device type not found: 'NoSuchDeviceType'"] },
      ],
    });
    await expect(new WorldMachineDeviceEditor(s.session).addDevice('NoSuchDeviceType')).rejects.toMatchObject(
      {
        code: 'WM_COMMAND_FAILED',
        worldMachineMessage: "Error: Error: Device type not found: 'NoSuchDeviceType'",
      },
    );
    expect(s.dirtyMarks()).toBe(0);
  });

  it('reports an add without its confirmation as UNEXPECTED_OUTPUT, dirty unchanged when nothing was added', async () => {
    const s = scriptedSession({
      'device list': [{ output: P2C_DEVICES }, { output: P2C_DEVICES }],
      // Assumed: an answer that is neither an error nor `Added '<name>'`; no capture shows one.
      'device add Gradient': [{ output: [] }],
    });
    await expect(new WorldMachineDeviceEditor(s.session).addDevice('Gradient')).rejects.toMatchObject({
      code: 'UNEXPECTED_OUTPUT',
    });
    expect(s.dirtyMarks()).toBe(0);
  });

  it('accepts an echoed name longer than 23 characters when device list shows its first 23 (spec fact 33)', async () => {
    const after = [
      'Devices (5 total):',
      ...P2C_DEVICES.slice(1),
      '  #5     ABCDEFGHIJKLMNOPQRSTUVW  (Gradient)',
    ];
    const s = scriptedSession({
      'device list': [{ output: P2C_DEVICES }, { output: after }],
      // Assumed: no capture shows a default type name longer than 23 characters; the echo follows fact 33's rule
      // that only the listing cuts the name.
      'device add Gradient': [{ output: ["Added 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'"] }],
    });
    expect(await new WorldMachineDeviceEditor(s.session).addDevice('Gradient')).toMatchObject({
      id: 5,
      name: 'ABCDEFGHIJKLMNOPQRSTUVW',
    });
  });

  it('reports a confirmed add that lists no new device as WM_COMMAND_FAILED (ruling K3)', async () => {
    const s = scriptedSession({
      'device list': [{ output: P2C_DEVICES }, { output: P2C_DEVICES }],
      // The confirmation of raw/p2c-edits.txt l.14-15. Assumed: an add without effect; no capture shows one.
      'device add Gradient': [{ output: ["Added 'Gradient'"] }],
    });
    await expect(new WorldMachineDeviceEditor(s.session).addDevice('Gradient')).rejects.toMatchObject({
      code: 'WM_COMMAND_FAILED',
      message: "World Machine confirmed adding 'Gradient', but device list shows no new device",
      worldMachineMessage: "Added 'Gradient'",
    });
    expect(s.dirtyMarks()).toBe(0);
  });
});

describe('WorldMachineDeviceEditor.renameDevice', () => {
  it('renames a device found by name in another case and reports the previous name', async () => {
    const { session, editor: e, record } = editor();
    await e.addDevice('Gradient');
    // A clean project, so the rename alone sets dirty.
    session.bind({ kind: 'fresh' });
    expect(await e.renameDevice('gradient', 'Grad B')).toEqual({
      device: { id: 536, name: 'Grad B', kind: 'Gradient', enabled: true, bypassed: false },
      previousName: 'Gradient',
    });
    expect(sent(record).slice(3)).toEqual(['device list', 'device rename #536 Grad B', 'device list']);
    expect(session.status().session.dirty).toBe(true);
  });

  it('reads a renamed device back with its type as the kind (raw/p2c-edits.txt l.28-36, spec fact 32)', async () => {
    const s = scriptedSession({
      'device list': [
        { output: P2C_DEVICES },
        {
          output: [
            'Devices (4 total):',
            '  #1     Gradient                ',
            '  #2     Combiner                ',
            '  #3     Height Output           ',
            '  #4     Grad A B                 (Gradient)',
          ],
        },
      ],
      'device rename #4 Grad A B': [{ output: ["Renamed '#4' to 'Grad A B'"] }],
    });
    expect(await new WorldMachineDeviceEditor(s.session).renameDevice('#4', 'Grad A B')).toEqual({
      device: { id: 4, name: 'Grad A B', kind: 'Gradient', enabled: true, bypassed: false },
      previousName: 'Gradient',
    });
    expect(s.batches).toEqual([['device list'], ['device rename #4 Grad A B', 'device list']]);
    expect(s.dirtyMarks()).toBe(1);
  });

  it('reports a confirmed rename that device list does not show as WM_COMMAND_FAILED (ruling K3)', async () => {
    const s = scriptedSession({
      // Assumed: a rename without effect; no capture shows one. The rows are raw/p2c-edits.txt l.21-25.
      'device list': [{ output: P2C_DEVICES }, { output: P2C_DEVICES }],
      'device rename #4 Grad A B': [{ output: ["Renamed '#4' to 'Grad A B'"] }],
    });
    await expect(
      new WorldMachineDeviceEditor(s.session).renameDevice('#4', 'Grad A B'),
    ).rejects.toMatchObject({
      code: 'WM_COMMAND_FAILED',
      message: "World Machine confirmed renaming #4 to 'Grad A B', but device list shows 'Gradient'",
    });
    expect(s.dirtyMarks()).toBe(1);
  });

  it('refuses a name two devices share and sends no rename', async () => {
    const { editor: e, record } = editor();
    await e.addDevice('Gradient');
    await e.addDevice('Gradient');
    await expect(e.renameDevice('Gradient', 'Grad C')).rejects.toMatchObject({
      code: 'REFUSED',
      message: "Device name 'Gradient' is ambiguous; use #<id>",
    });
    expect(sent(record).some((line) => line.startsWith('device rename'))).toBe(false);
  });

  it('refuses a device the project does not list and sends no rename', async () => {
    const { editor: e, record } = editor();
    await expect(e.renameDevice('Nope', 'Grad C')).rejects.toMatchObject({ code: 'REFUSED' });
    expect(sent(record)).toEqual(['device list']);
  });

  it.each([' Grad', 'Grad  (Macro)', '#7'])(
    'refuses the new name %j before World Machine starts',
    async (name) => {
      const { editor: e, record } = editor();
      await expect(e.renameDevice('#35', name)).rejects.toMatchObject({ code: 'REFUSED' });
      expect(record.lines()).toEqual([]);
    },
  );
});

// raw/p2b-graph-edits.txt l.48-51: #1 disabled.
const DISABLED_GRADIENT_LIST = [
  'Devices (2 total):',
  '  #1     Gradient                 [disabled]',
  '  #2     Combiner                ',
];
// raw/p2b-graph-edits.txt l.40-45.
const GRADIENT_INFO_DISABLED = [
  'Selected device:',
  '  Name:    Gradient',
  '  Type:    Gradient',
  '  Enabled: no',
  '  Bypass:  no',
];

describe('WorldMachineDeviceEditor.setDeviceEnabled', () => {
  it('disables a device, reads it back, and marks the project modified', async () => {
    const { session, editor: e, record } = editor();
    await e.addDevice('Gradient');
    session.bind({ kind: 'fresh' });
    expect(await e.setDeviceEnabled('Gradient', false)).toEqual({
      device: { id: 536, name: 'Gradient' },
      enabled: false,
      changed: true,
    });
    expect(sent(record).slice(3)).toEqual([
      'device list',
      'device disable #536',
      'device select #536',
      'device info',
    ]);
    expect(session.status().session.dirty).toBe(true);
  });

  it('reports changed: false and leaves dirty alone for a device already in that state (spec fact 25)', async () => {
    const { session, editor: e } = editor();
    await e.addDevice('Gradient');
    session.bind({ kind: 'fresh' });
    expect(await e.setDeviceEnabled('#536', true)).toEqual({
      device: { id: 536, name: 'Gradient' },
      enabled: true,
      changed: false,
    });
    expect(session.status().session.dirty).toBe(false);
  });

  it('enables a disabled device again', async () => {
    const { session, editor: e } = editor();
    await e.addDevice('Gradient');
    await e.setDeviceEnabled('#536', false);
    session.bind({ kind: 'fresh' });
    expect((await e.setDeviceEnabled('#536', true)).changed).toBe(true);
    expect(session.status().session.dirty).toBe(true);
  });

  it('reports a read-back that disagrees with the request as WM_COMMAND_FAILED', async () => {
    const s = scriptedSession({
      'device list': [{ output: DISABLED_GRADIENT_LIST }],
      // raw/p2b-graph-edits.txt l.57-58 and l.37-38.
      'device enable #1': [{ output: ['Enabled: #1'] }],
      'device select #1': [{ output: ['Selected: Gradient'] }],
      // Assumed: an enable without effect; no capture shows one.
      'device info': [{ output: GRADIENT_INFO_DISABLED }],
    });
    await expect(new WorldMachineDeviceEditor(s.session).setDeviceEnabled('#1', true)).rejects.toMatchObject({
      code: 'WM_COMMAND_FAILED',
      message: 'World Machine still reports #1 as disabled',
    });
    expect(s.dirtyMarks()).toBe(0);
  });

  it('counts the project as modified when the read-back fails', async () => {
    const s = scriptedSession({
      'device list': [{ output: DISABLED_GRADIENT_LIST }],
      'device enable #1': [{ output: ['Enabled: #1'] }],
      'device select #1': [{ output: ['Selected: Gradient'] }],
      // Assumed: a read-back failure constructed from raw/p2a-edge-cases.txt l.23-24, where no device was selected;
      // no capture shows it after a successful `device select`.
      'device info': [{ output: ['No device selected.'] }],
    });
    await expect(new WorldMachineDeviceEditor(s.session).setDeviceEnabled('#1', true)).rejects.toMatchObject({
      code: 'UNEXPECTED_OUTPUT',
    });
    expect(s.dirtyMarks()).toBe(1);
  });
});

describe('WorldMachineDeviceEditor.deleteDevice', () => {
  it('deletes a device by id and checks that device list no longer shows it', async () => {
    const { session, editor: e, record } = editor();
    await e.addDevice('Gradient');
    await e.addDevice('Gradient');
    session.bind({ kind: 'fresh' });
    expect(await e.deleteDevice('#536')).toEqual(GRADIENT_536);
    expect(sent(record).slice(6)).toEqual(['device list', 'device delete #536', 'device list']);
    expect(session.status().session.dirty).toBe(true);
  });

  it('reports a device that device list still shows as WM_COMMAND_FAILED', async () => {
    const s = scriptedSession({
      // Assumed: a delete without effect, so the second list still shows #1; no capture shows one.
      'device list': [{ output: DISABLED_GRADIENT_LIST }, { output: DISABLED_GRADIENT_LIST }],
      // raw/p2b-graph-edits.txt l.150-151.
      'device delete #1': [{ output: ['Deleted: #1'] }],
    });
    await expect(new WorldMachineDeviceEditor(s.session).deleteDevice('Gradient')).rejects.toMatchObject({
      code: 'WM_COMMAND_FAILED',
      message: 'World Machine confirmed deleting #1, but device list still shows it',
    });
    expect(s.dirtyMarks()).toBe(1);
  });

  it('refuses a device the project does not list', async () => {
    const { editor: e, record } = editor();
    await expect(e.deleteDevice('#999')).rejects.toMatchObject({ code: 'REFUSED' });
    expect(sent(record)).toEqual(['device list']);
  });
});
