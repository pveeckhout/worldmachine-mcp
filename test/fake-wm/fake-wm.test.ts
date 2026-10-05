import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FsPathPolicy } from '../../src/adapter/out/fs/path-policy.js';
import { WorldMachineProcess } from '../../src/adapter/out/worldmachine/world-machine-process.js';
import { WorldMachineSession } from '../../src/adapter/out/worldmachine/world-machine-session.js';
import { captureLogger, FAKE_WM, fakeEnv } from '../support/fake-wm.js';

const sessions: WorldMachineSession[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.shutdown()));
});

function session(): WorldMachineSession {
  const logger = captureLogger();
  const env = fakeEnv();
  const created = new WorldMachineSession({
    executable: FAKE_WM,
    defaultProject: undefined,
    pathPolicy: new FsPathPolicy([mkdtempSync(join(tmpdir(), 'fake-wm-test-'))]),
    commandTimeoutMs: 2_000,
    idleTimeoutMs: 0,
    logger,
    startProcess: (bin, signal, onSpawn) =>
      WorldMachineProcess.start({ bin, readyTimeoutMs: 5_000, logger, env, signal, onSpawn }),
  });
  sessions.push(created);
  return created;
}

/** Output and error lines of each command, in batch order. */
async function outputs(s: WorldMachineSession, commands: string[]): Promise<string[][]> {
  return (await s.execute(commands)).map((response) => [...response.output, ...response.errors]);
}

const NO_DEVICE_SELECTED =
  "Error: Error: No device selected. Use 'param set <device>.<param> <value>' or select a device first.";

describe('fake World Machine', () => {
  it('adds devices to an empty project as raw/v6b-param-set.txt shows', async () => {
    expect(
      await outputs(session(), [
        'project new blank force',
        'device list',
        'device add Gradient',
        'device add File Output',
        'device list',
      ]),
    ).toEqual([
      ['Created new blank project.'],
      ['No devices in the current project.'],
      ["Added 'Gradient'"],
      ["Added 'Height Output'"],
      ['Devices (2 total):', '  #1     Gradient                ', '  #2     Height Output           '],
    ]);
  });

  it('adds two devices of one type under one name (spec fact 30)', async () => {
    expect(
      await outputs(session(), [
        'project new blank force',
        'device add Gradient',
        'device add Gradient',
        'device list',
      ]),
    ).toEqual([
      ['Created new blank project.'],
      ["Added 'Gradient'"],
      ["Added 'Gradient'"],
      ['Devices (2 total):', '  #1     Gradient                ', '  #2     Gradient                '],
    ]);
  });

  it('filters device list by name and keeps the unfiltered total (raw/device-list-sample.txt)', async () => {
    expect(await outputs(session(), ['device list Height'])).toEqual([
      ['Devices (17 total):', '  #1     Height Output           '],
    ]);
  });

  it('adds devices to the sample project as raw/p2b-kind-markers.txt shows', async () => {
    expect(
      await outputs(session(), [
        'project new default force',
        'device add Gradient',
        'device add Gradient',
        'device add Erosion',
        'device list Gradient',
        'device list Erosion',
      ]),
    ).toEqual([
      ['Created new default project.'],
      ["Added 'Gradient'"],
      ["Added 'Gradient'"],
      ["Added 'Erosion'"],
      ['Devices (20 total):', '  #536   Gradient                ', '  #537   Gradient                '],
      ['Devices (20 total):', '  #35    Erosion                 ', '  #538   Erosion                 '],
    ]);
  });

  it('starts ids again at #1 in a new blank project', async () => {
    const s = session();
    await outputs(s, ['project new blank force', 'device add Gradient']);
    expect(await outputs(s, ['project new blank force', 'device add Combiner', 'device list'])).toEqual([
      ['Created new blank project.'],
      ["Added 'Combiner'"],
      ['Devices (1 total):', '  #1     Combiner                '],
    ]);
  });

  it.each([
    [
      'a quoted device name',
      'param set "Height Output".exportAlways true',
      'Set Height Output.exportAlways = true',
    ],
    [
      'a quoted reference',
      'param set "Height Output.exportAlways" false',
      'Set Height Output.exportAlways = false',
    ],
    ['an id reference', 'param set #2.exportAlways true', 'Set #2.exportAlways = true'],
    [
      'a quoted value with spaces',
      'param set #2.filename "/w/dir with space/quoted file.png"',
      'Set #2.filename = /w/dir with space/quoted file.png',
    ],
  ])('echoes param set with %s as raw/v6b-param-set.txt shows', async (_label, command, echo) => {
    expect(await outputs(session(), [command])).toEqual([[echo]]);
  });

  it('selects an added device by name in any case and shows its info (spec fact 31)', async () => {
    // raw/p2b-kind-markers.txt l.122-123; device info as in raw/p2a-edge-cases.txt l.48-53.
    expect(
      await outputs(session(), [
        'project new blank force',
        'device add Gradient',
        'device select gradient',
        'device info',
      ]),
    ).toEqual([
      ['Created new blank project.'],
      ["Added 'Gradient'"],
      ['Selected: Gradient'],
      ['Selected device:', '  Name:    Gradient', '  Type:    Gradient', '  Enabled: yes', '  Bypass:  no'],
    ]);
  });

  it('selects the sample Erosion by name in another case', async () => {
    expect(await outputs(session(), ['device select erosion', 'device info'])).toEqual([
      ['Selected: Erosion'],
      ['Selected device:', '  Name:    Erosion', '  Type:    Erosion', '  Enabled: yes', '  Bypass:  no'],
    ]);
  });

  it('disables, enables, renames, and deletes added devices as captured', async () => {
    expect(
      await outputs(session(), [
        'project new blank force',
        'device add Gradient',
        'device add Combiner',
        'device disable #1',
        'device list',
        'device select #1',
        'device info',
        'device enable #1',
        'device rename #1 Grad A',
        'device list',
        'device delete #2',
        'device list',
      ]),
    ).toEqual([
      ['Created new blank project.'],
      ["Added 'Gradient'"],
      ["Added 'Combiner'"],
      // raw/p2b-graph-edits.txt l.34-35 and l.48-51.
      ['Disabled: #1'],
      [
        'Devices (2 total):',
        '  #1     Gradient                 [disabled]',
        '  #2     Combiner                ',
      ],
      ['Selected: Gradient'],
      ['Selected device:', '  Name:    Gradient', '  Type:    Gradient', '  Enabled: no', '  Bypass:  no'],
      // raw/p2b-graph-edits.txt l.57-58.
      ['Enabled: #1'],
      // raw/v4-quoting.txt l.70-71 (echo) and l.16-18 (row of a renamed device).
      ["Renamed '#1' to 'Grad A'"],
      [
        'Devices (2 total):',
        '  #1     Grad A                   (Gradient)',
        '  #2     Combiner                ',
      ],
      // raw/p2b-graph-edits.txt l.150-155.
      ['Deleted: #2'],
      ['Devices (1 total):', '  #1     Grad A                   (Gradient)'],
    ]);
  });

  it('lists a device renamed to a 30-character name as its first 23 characters (spec fact 33)', async () => {
    expect(
      await outputs(session(), [
        'project new blank force',
        'device add Gradient',
        'device rename #1 ABCDEFGHIJKLMNOPQRSTUVWXYZ0123',
        'device list',
      ]),
    ).toEqual([
      ['Created new blank project.'],
      ["Added 'Gradient'"],
      ["Renamed '#1' to 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123'"],
      // raw/p2c-edits.txt l.64-69: the row shows the first 23 characters.
      ['Devices (1 total):', '  #1     ABCDEFGHIJKLMNOPQRSTUVW  (Gradient)'],
    ]);
  });

  it('reports a device it does not have as not found (raw/p2b-graph-edits.txt l.108-109)', async () => {
    expect(
      await outputs(session(), ['project new blank force', 'device enable capture_missing_device']),
    ).toEqual([['Created new blank project.'], ["Error: Error: Device not found: 'capture_missing_device'"]]);
  });

  it('rejects an unquoted name with a space when no device is selected (raw/v6-param-values.txt)', async () => {
    expect(await outputs(session(), ['param set Height Output.exportAlways true'])).toEqual([
      [NO_DEVICE_SELECTED],
    ]);
  });
});
