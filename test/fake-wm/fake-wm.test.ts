import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FsPathPolicy } from '../../src/adapter/out/fs/path-policy.js';
import { parseParamList } from '../../src/adapter/out/worldmachine/parsers/param-list.js';
import { WorldMachineGraphReader } from '../../src/adapter/out/worldmachine/world-machine-graph-reader.js';
import { WorldMachineParameterEditor } from '../../src/adapter/out/worldmachine/world-machine-parameter-editor.js';
import { WorldMachineProcess } from '../../src/adapter/out/worldmachine/world-machine-process.js';
import { WorldMachineSession } from '../../src/adapter/out/worldmachine/world-machine-session.js';
import { captureLogger, FAKE_WM, fakeEnv, waitUntil } from '../support/fake-wm.js';

const sessions: WorldMachineSession[] = [];
const processes: WorldMachineProcess[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.shutdown()));
  await Promise.all(processes.splice(0).map((proc) => proc.quit(2_000, 0)));
});

function session(extra: Record<string, string> = {}): WorldMachineSession {
  const logger = captureLogger();
  const env = fakeEnv(extra);
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

  it('toggles bypass of an added device with the captured confirmations, listing and info included', async () => {
    // raw/p2b-graph-edits.txt l.74-95: `Set bypass: #1`, `Bypass:  yes`, `[bypassed]`, then `Removed bypass: #1`.
    expect(
      await outputs(session(), [
        'project new blank force',
        'device add Gradient',
        'device bypass #1',
        'device select #1',
        'device info',
        'device list',
        'device bypass #1',
        'device select #1',
        'device info',
      ]),
    ).toEqual([
      ['Created new blank project.'],
      ["Added 'Gradient'"],
      ['Set bypass: #1'],
      ['Selected: Gradient'],
      ['Selected device:', '  Name:    Gradient', '  Type:    Gradient', '  Enabled: yes', '  Bypass:  yes'],
      ['Devices (1 total):', '  #1     Gradient                 [bypassed]'],
      ['Removed bypass: #1'],
      ['Selected: Gradient'],
      ['Selected device:', '  Name:    Gradient', '  Type:    Gradient', '  Enabled: yes', '  Bypass:  no'],
    ]);
  });

  it('lists [disabled] only for a device that is both disabled and bypassed (spec fact 29)', async () => {
    expect(
      await outputs(session(), [
        'project new blank force',
        'device add Gradient',
        'device bypass #1',
        'device disable #1',
        'device list',
      ]),
    ).toEqual([
      ['Created new blank project.'],
      ["Added 'Gradient'"],
      ['Set bypass: #1'],
      ['Disabled: #1'],
      ['Devices (1 total):', '  #1     Gradient                 [disabled]'],
    ]);
  });

  it('refuses bypass of an unknown device with the captured error', async () => {
    // raw/p2b-graph-edits.txt l.114-115.
    expect(await outputs(session(), ['project new blank force', 'device bypass #99'])).toEqual([
      ['Created new blank project.'],
      ["Error: Error: Device not found: '#99'"],
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

/** Snapshot times as `<time>`; a time in another format stays and fails the comparison (spec v2b fact 57). */
const timeless = (frames: string[][]) =>
  frames.map((frame) => frame.map((line) => line.replace(/ - \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, ' - <time>')));

const UNSAVED_NEW =
  "Error: Error: Project has unsaved changes. Use 'project save' first or 'project new force'.";

// raw/v2b-groups.txt l.38-55: the sample project after `group disable Create your Terrain`.
const GROUP_0_DISABLED = [
  'Devices (17 total):',
  '  #1     Height Output           ',
  '  #2     Advanced Perlin          [disabled]',
  '  #3     Curves                   [disabled]',
  '  #35    Erosion                  [disabled]',
  '  #36    Scene View              ',
  '  #222   Vegetation Layer        ',
  '  #304   Layers                  ',
  '  #305   Thermal Weathering       [disabled]',
  '  #307   Ambient Occlusion       ',
  '  #308   Material Output         ',
  '  #309   Colormap only            (Bitmap Output)',
  '  #310   Tap                     ',
  '  #314   Flow Restructure         [disabled]',
  '  #317   Texture Weightmap       ',
  '  #318   Splatmap                 (Bitmap Output)',
  '  #319   Easy Distortion          (Macro) [disabled]',
  '  #373   Rock and Soil           ',
];

describe('fake World Machine snapshots, organize, and groups (spec v2b facts 57-67)', () => {
  it('lists and creates snapshots, and a snapshot is not an unsaved change (raw/v2b-snapshots.txt l.20-39, l.80-98)', async () => {
    expect(
      timeless(
        await outputs(session(), [
          'snapshot list',
          'snapshots',
          'snapshot create A',
          'snapshot create',
          'snapshot create B with space',
          'snapshot create A',
          'snapshot list',
          'project new default',
          'snapshot list',
        ]),
      ),
    ).toEqual([
      ['No snapshots.'],
      ['No snapshots.'],
      ["Created snapshot 'A'"],
      ['Error: Error: Usage: snapshot create <name>'],
      ["Created snapshot 'B with space'"],
      ["Created snapshot 'A'"],
      [
        'Snapshots (3 total):',
        "  [#0] 'A' - <time>",
        "  [#1] 'B with space' - <time>",
        "  [#2] 'A' - <time>",
      ],
      ['Created new default project.'],
      ['No snapshots.'],
    ]);
  });

  it('refuses snapshot references as captured (facts 58 and 61)', async () => {
    expect(
      await outputs(session(), [
        'snapshot create A',
        'snapshot create B',
        'snapshot create A',
        'snapshot restore A',
        'snapshot restore missing',
        'snapshot restore #99',
        'snapshot delete missing',
        'snapshot delete #3',
      ]),
    ).toEqual([
      ["Created snapshot 'A'"],
      ["Created snapshot 'B'"],
      ["Created snapshot 'A'"],
      // raw/v2b-snapshots.txt l.100-104; outputs() lists the plain lines before the Error: line.
      [
        "  [#0] 'A'",
        "  [#2] 'A'",
        'Use #index to specify which one.',
        "Error: Error: Multiple snapshots match 'A':",
      ],
      ["Error: Error: Snapshot not found: 'missing'"],
      ['Error: Error: Invalid snapshot index: #99 (valid range: #0 - #2)'],
      ["Error: Error: Snapshot not found: 'missing'"],
      ['Error: Error: Invalid snapshot index: #3 (valid range: #0 - #2)'],
    ]);
  });

  it('restores the graph of a snapshot, keeps later snapshots, and marks the project unsaved (fact 60)', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'fake-wm-snapshot-'));
    const frames = timeless(
      await outputs(session(), [
        'snapshot create S0',
        'group disable #0',
        'device add Gradient',
        'snapshot create S1',
        `project save ${folder}/restore.tmd`,
        'device list',
        'snapshot restore #0',
        'device list',
        'snapshot list',
        'project new default',
      ]),
    );
    expect(frames[5]).toEqual([
      'Devices (18 total):',
      ...GROUP_0_DISABLED.slice(1),
      '  #536   Gradient                ',
    ]);
    expect(frames.slice(6, 8)).toEqual([
      ["Restored snapshot [#0] 'S0'"],
      GROUP_0_DISABLED.map((row) => row.replace(' [disabled]', '')),
    ]);
    expect(frames.slice(8)).toEqual([
      ['Snapshots (2 total):', "  [#0] 'S0' - <time>", "  [#1] 'S1' - <time>"],
      [UNSAVED_NEW],
    ]);
  });

  it('brings back only the snapshots of the last save when a project is opened (fact 59)', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'fake-wm-snapshot-'));
    expect(
      timeless(
        await outputs(session(), [
          'snapshot create A',
          `project save ${folder}/kept.tmd`,
          'snapshot create B',
          `project open ${folder}/kept.tmd force`,
          'snapshot list',
          'project close force',
          `project open ${folder}/kept.tmd force`,
          'snapshot list',
          `project open ${folder}/other.tmd force`,
          'snapshot list',
        ]),
      ).slice(3),
    ).toEqual([
      [`Opened: ${folder}/kept.tmd`],
      ['Snapshots (1 total):', "  [#0] 'A' - <time>"],
      ['Project closed.'],
      [`Opened: ${folder}/kept.tmd`],
      ['Snapshots (1 total):', "  [#0] 'A' - <time>"],
      [`Opened: ${folder}/other.tmd`],
      ['No snapshots.'],
    ]);
  });

  it('deletes snapshots by name or index and shifts the indexes down (fact 61)', async () => {
    expect(
      timeless(
        await outputs(session(), [
          'snapshot create A',
          'snapshot create B with space',
          'snapshot create C',
          'snapshot delete B with space',
          'snapshot delete #0',
          'snapshot list',
        ]),
      ).slice(3),
    ).toEqual([
      ["Deleted snapshot [#1] 'B with space'"],
      ["Deleted snapshot [#0] 'A'"],
      ['Snapshots (1 total):', "  [#0] 'C' - <time>"],
    ]);
  });

  it('organizes the devices as an unsaved change (fact 62)', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'fake-wm-organize-'));
    expect(
      await outputs(session(), [`project save ${folder}/o.tmd`, 'device organize', 'project new default']),
    ).toEqual([
      [`Project saved to: ${folder}/o.tmd`],
      ['Devices organized by processing order.'],
      [UNSAVED_NEW],
    ]);
  });

  it('lists groups with and without a filter (fact 63, raw/v2b-groups.txt l.16-32)', async () => {
    expect(
      await outputs(session(), [
        'group list',
        'group list Export',
        'group list nomatch',
        'project new blank force',
        'group list',
      ]),
    ).toEqual([
      [
        'Groups (5 total):',
        '  [#0] Create your Terrain      (6 devices)',
        '  [#1] Export Basics            (4 devices)',
        '  [#2] Texture & View           (5 devices)',
        '  [#3] Welcome to World Machine! (0 devices)',
        '  [#4] Material Maps            (2 devices)',
      ],
      ['Groups (5 total):', '  [#1] Export Basics            (4 devices)'],
      ['Groups (5 total):', '  (no matches)'],
      ['Created new blank project.'],
      ['No groups in the current project.'],
    ]);
  });

  it('disables and enables the members of a group and refuses what it cannot find (facts 64 and 65)', async () => {
    expect(
      await outputs(session(), [
        'group disable Create your Terrain',
        'device list',
        'group enable create your terrain',
        'device list',
        'group enable Texture & View',
        'group disable missing',
        'group enable #99',
        'group disable Welcome to World Machine!',
      ]),
    ).toEqual([
      ["Disabled 6 device(s) in group 'Create your Terrain'"],
      GROUP_0_DISABLED,
      ["Enabled 6 device(s) in group 'Create your Terrain'"],
      GROUP_0_DISABLED.map((row) => row.replace(' [disabled]', '')),
      ["Enabled 5 device(s) in group 'Texture & View'"],
      ["Error: Error: Group not found: 'missing'"],
      ['Error: Error: Invalid group index: #99 (valid range: #0 - #4)'],
      ["Group 'Welcome to World Machine!' contains no devices."],
    ]);
  });

  it('counts a group change as unsaved, and an empty group as no change (facts 64 and 65)', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'fake-wm-groups-'));
    expect(
      await outputs(session(), [
        `project save ${folder}/g.tmd`,
        'group disable #3',
        'project new default',
        'group disable #0',
        'project new default',
      ]),
    ).toEqual([
      [`Project saved to: ${folder}/g.tmd`],
      ["Group 'Welcome to World Machine!' contains no devices."],
      ['Created new default project.'],
      ["Disabled 6 device(s) in group 'Create your Terrain'"],
      [UNSAVED_NEW],
    ]);
  });

  it('runs a group build whose late line is its own (fact 66, raw/v2b-groups.txt l.274-283)', async () => {
    const { proc, stream } = await streamed({ FAKE_WM_BUILD_MS: '100' });
    proc.write(['group build #0']);
    await waitUntil(() => stream.includes('<group-build-started>'));
    expect(stream).toEqual([
      '<sleep-prohibited>',
      '<starting>',
      '<ended>',
      '<sleep-allowed>',
      '<group-build-started>',
    ]);
  });

  it('stops a group build, which prints no late line (fact 72, raw/v2b-assumptions.txt l.217-230)', async () => {
    const { proc, stream } = await streamed({ FAKE_WM_BUILD_MS: '5000', FAKE_WM_LATE_MS: '20' });
    proc.write(['group build #0']);
    await waitUntil(() => stream.includes('<starting>'));
    proc.write(['build stop']);
    await waitUntil(() => stream.includes('<sleep-allowed>'));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(stream).toEqual([
      '<sleep-prohibited>',
      '<starting>',
      'Stop requested.',
      '<ended>',
      '<sleep-allowed>',
    ]);
  });

  it('exports Height Output in a group build that includes it when its exportAlways is set (fact 71)', async () => {
    const { proc, stream, logger } = await streamed({ FAKE_WM_BUILD_MS: '100' });
    // raw/v2b-assumptions.txt l.123-124 and l.159-169: group #1 'Export Basics' exports it, inside its start frame.
    proc.write(['param set #1.exportAlways true']);
    await waitUntil(() => stream.includes('Set #1.exportAlways = true'));
    proc.write(['group build #1']);
    await waitUntil(() => stream.includes('<group-build-started>'));
    expect(stream.slice(1)).toEqual([
      '<sleep-prohibited>',
      '<starting>',
      '<other>',
      '<ended>',
      '<sleep-allowed>',
      '<group-build-started>',
    ]);
    expect(logger.lines).toContain(
      'debug: World Machine build event: [Build Event] Automatic export of file ' +
        '/fake-home/Documents/WorldMachine/New Project Height Output-2049.png succeeded',
    );
    // l.143-153: group #0 'Create your Terrain' does not include it.
    stream.length = 0;
    proc.write(['group build #0']);
    await waitUntil(() => stream.includes('<group-build-started>'));
    expect(stream).not.toContain('<other>');
  });

  it('starts a group build as if from the World Machine window with FAKE_WM_GUI_BUILD=group', async () => {
    const { proc, stream } = await streamed({
      FAKE_WM_BUILD_MS: '100',
      FAKE_WM_GUI_BUILD: 'group',
      FAKE_WM_GUI_BUILD_ON: 'build status',
    });
    proc.write(['build status']);
    await waitUntil(() => stream.includes('<group-build-started>'));
    expect(stream).toEqual([
      '<sleep-prohibited>',
      '<starting>',
      'No build running.',
      '<ended>',
      '<sleep-allowed>',
      '<group-build-started>',
    ]);
  });

  it('refuses missing and empty groups for a build and leaves the outputs unbuilt after one (facts 65-67)', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'fake-wm-groups-'));
    const s = session({ FAKE_WM_BUILD_MS: '50' });
    expect(
      await outputs(s, [
        `project save ${folder}/g.tmd`,
        'group build missing',
        'group build #3',
        'group build #0',
      ]),
    ).toEqual([
      [`Project saved to: ${folder}/g.tmd`],
      ["Error: Error: Group not found: 'missing'"],
      ["Group 'Welcome to World Machine!' contains no devices."],
      [],
    ]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await outputs(s, ['export all'])).toEqual([
      ["Error: Error: Some output devices are not built. Run 'build' first, then export."],
    ]);
  });
});

/**
 * A fake World Machine without a session, recording its output lines and build events (as `<event>`) in arrival
 * order. Commands go one per write; a test waits for an answer before the next.
 */
async function streamed(extra: Record<string, string> = {}) {
  const logger = captureLogger();
  const proc = await WorldMachineProcess.start({
    bin: FAKE_WM,
    readyTimeoutMs: 5_000,
    logger,
    env: fakeEnv(extra),
  });
  processes.push(proc);
  const stream: string[] = [];
  proc.onLine((line) => stream.push(line));
  proc.onBuildEvent((event) => stream.push(`<${event}>`));
  return { proc, stream, logger };
}

describe('fake World Machine builds and exports (spec v2a facts 42-50)', () => {
  it('starts a full build, ends it, and confirms it late (raw/v2-build-isolate.txt l.54-68)', async () => {
    const { proc, stream } = await streamed({ FAKE_WM_BUILD_MS: '100' });
    proc.write(['build start']);
    await waitUntil(() => stream.includes('<build-started>'));
    expect(stream).toEqual([
      '<sleep-prohibited>',
      '<starting>',
      '<ended>',
      '<sleep-allowed>',
      '<build-started>',
    ]);
  });

  it('exports Height Output in a full build when its exportAlways is set (assumed, as a group build does, fact 71)', async () => {
    const { proc, stream, logger } = await streamed({ FAKE_WM_BUILD_MS: '100', FAKE_WM_EXPORT_ALWAYS: '1' });
    proc.write(['build start']);
    await waitUntil(() => stream.includes('<build-started>'));
    expect(stream).toEqual([
      '<sleep-prohibited>',
      '<starting>',
      '<other>',
      '<ended>',
      '<sleep-allowed>',
      '<build-started>',
    ]);
    expect(logger.lines.filter((line) => line.includes('Automatic export'))).toHaveLength(1);
  });

  it('replaces a running full build in one frame (fact 45, raw/v2-build-long.txt l.56-60)', async () => {
    const { proc, stream } = await streamed({ FAKE_WM_BUILD_MS: '5000' });
    proc.write(['build start']);
    await waitUntil(() => stream.includes('<starting>'));
    proc.write(['build start']);
    await waitUntil(() => stream.filter((line) => line === '<starting>').length === 2);
    expect(stream).toEqual([
      '<sleep-prohibited>',
      '<starting>',
      '<ended>',
      '<sleep-prohibited>',
      '<starting>',
      '<sleep-allowed>',
    ]);
  });

  it('runs a tiled build with only the sleep events (fact 48)', async () => {
    const { proc, stream } = await streamed({ FAKE_WM_BUILD_MS: '100' });
    proc.write(['build start tiled']);
    await waitUntil(() => stream.includes('<tiled-started>'));
    expect(stream).toEqual(['<sleep-prohibited>', '<sleep-allowed>', '<tiled-started>']);
  });

  it('stops a full build (fact 46, raw/v2-build-long.txt l.62-68)', async () => {
    const { proc, stream } = await streamed({ FAKE_WM_BUILD_MS: '5000' });
    proc.write(['build start']);
    await waitUntil(() => stream.includes('<starting>'));
    proc.write(['build stop']);
    await waitUntil(() => stream.includes('<build-started>'));
    expect(stream).toEqual([
      '<sleep-prohibited>',
      '<starting>',
      'Stop requested.',
      '<ended>',
      '<sleep-allowed>',
      '<build-started>',
    ]);
  });

  it('stops a tiled build and confirms it only after the next tiled build (raw/v2-build-concurrency.txt l.164-210)', async () => {
    const { proc, stream } = await streamed({ FAKE_WM_BUILD_MS: '300' });
    proc.write(['build start tiled']);
    await waitUntil(() => stream.includes('<sleep-prohibited>'));
    proc.write(['build stop']);
    await waitUntil(() => stream.includes('<sleep-allowed>'));
    expect(stream).toEqual(['<sleep-prohibited>', 'Stop requested.', '<sleep-allowed>']);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(stream).not.toContain('<tiled-started>');
    proc.write(['build start tiled']);
    await waitUntil(() => stream.filter((line) => line === '<tiled-started>').length === 2);
    expect(stream.slice(3)).toEqual([
      '<sleep-prohibited>',
      '<sleep-allowed>',
      '<tiled-started>',
      '<tiled-started>',
    ]);
  });

  it('holds a full build trailer until the next start with FAKE_WM_LATE_TRAILER (raw/v2-build-long.txt l.57-60)', async () => {
    const { proc, stream } = await streamed({ FAKE_WM_BUILD_MS: '100', FAKE_WM_LATE_TRAILER: '1' });
    proc.write(['build start']);
    await waitUntil(() => stream.includes('<build-started>'));
    proc.write(['build start tiled']);
    await waitUntil(() => stream.includes('<sleep-allowed>'));
    expect(stream).toEqual([
      '<sleep-prohibited>',
      '<starting>',
      '<ended>',
      '<build-started>',
      '<sleep-prohibited>',
      '<sleep-allowed>',
    ]);
  });

  it('releases a stopped full build trailer at a tiled start sent right after the stop (FAKE_WM_LATE_TRAILER)', async () => {
    const { proc, stream } = await streamed({ FAKE_WM_BUILD_MS: '1000', FAKE_WM_LATE_TRAILER: '1' });
    proc.write(['build start']);
    await waitUntil(() => stream.includes('<starting>'));
    // Back to back: the tiled start leaves as soon as the stop's Ended arrives, well inside the fake's 20 ms delay.
    proc.onBuildEvent((event) => {
      if (event === 'ended') proc.write(['build start tiled']);
    });
    proc.write(['build stop']);
    await waitUntil(() => stream.includes('<tiled-started>'));
    expect(stream.filter((line) => line !== '<build-started>')).toEqual([
      '<sleep-prohibited>',
      '<starting>',
      'Stop requested.',
      '<ended>',
      '<sleep-prohibited>',
      '<sleep-allowed>',
      '<sleep-allowed>',
      '<tiled-started>',
    ]);
  });

  it('starts a tiled build as if from the World Machine window with FAKE_WM_GUI_BUILD (assumption A1)', async () => {
    const { proc, stream } = await streamed({
      FAKE_WM_BUILD_MS: '100',
      FAKE_WM_GUI_BUILD: 'tiled',
      FAKE_WM_GUI_BUILD_ON: 'build status',
    });
    proc.write(['build status']);
    await waitUntil(() => stream.includes('<tiled-started>'));
    proc.write(['build status']);
    await waitUntil(() => stream.filter((line) => line === 'No build running.').length === 2);
    expect(stream).toEqual([
      '<sleep-prohibited>',
      'No build running.',
      '<sleep-allowed>',
      '<tiled-started>',
      'No build running.',
    ]);
  });

  it('starts a full build as if from the World Machine window with FAKE_WM_GUI_BUILD (assumption A1)', async () => {
    const { proc, stream } = await streamed({
      FAKE_WM_BUILD_MS: '100',
      FAKE_WM_GUI_BUILD: 'full',
      FAKE_WM_GUI_BUILD_ON: 'build status',
    });
    proc.write(['build status']);
    await waitUntil(() => stream.includes('<build-started>'));
    expect(stream).toEqual([
      '<sleep-prohibited>',
      '<starting>',
      'No build running.',
      '<ended>',
      '<sleep-allowed>',
      '<build-started>',
    ]);
  });

  it('prints the opening events after the start frame with FAKE_WM_START_DELAY_MS', async () => {
    const { proc, stream } = await streamed({ FAKE_WM_BUILD_MS: '5000', FAKE_WM_START_DELAY_MS: '200' });
    proc.write(['build start']);
    await new Promise((resolve) => setTimeout(resolve, 50));
    proc.write(['build status']);
    await waitUntil(() => stream.includes('<starting>'));
    expect(stream).toEqual(['No build running.', '<sleep-prohibited>', '<starting>']);
  });

  it('ends a build inside the frame of the command named by FAKE_WM_BUILD_END_ON (fact 47)', async () => {
    const { proc, stream } = await streamed({
      FAKE_WM_BUILD_MS: '60000',
      FAKE_WM_BUILD_END_ON: 'device list',
    });
    proc.write(['build start']);
    await waitUntil(() => stream.includes('<starting>'));
    proc.write(['device list']);
    await waitUntil(() => stream.includes('Devices (17 total):'));
    expect(stream.indexOf('<ended>')).toBeLessThan(stream.indexOf('Devices (17 total):'));
  });

  it('reports a preview through build status only (facts 42, 44)', async () => {
    const s = session({ FAKE_WM_PREVIEW_MS: '300', FAKE_WM_BUILD_MS: '5000' });
    expect(await outputs(s, ['build preview', 'build status', 'build start', 'build status'])).toEqual([
      ['Preview build started.'],
      ['Build in progress...'],
      [],
      ['No build running.'],
    ]);
    expect(await outputs(s, ['build stop', 'build status'])).toEqual([
      ['Stop requested.'],
      ['No build running.'],
    ]);
  });

  it('reads exportAlways of the default outputs by id (raw/v2-build-isolate.txt l.17-42, fact 51)', async () => {
    expect(
      await outputs(session({ FAKE_WM_EXPORT_ALWAYS: '1' }), [
        'param get #1.exportAlways',
        'param get #318.exportAlways',
      ]),
    ).toEqual([
      ['#1.exportAlways = true'],
      ["Error: Error: Parameter 'exportAlways' not found on device '#318'."],
    ]);
    expect(await outputs(session(), ['param get #1.exportAlways'])).toEqual([['#1.exportAlways = false']]);
  });

  it('lists the default exports and refuses export all before a build (facts 49, 50)', async () => {
    expect(await outputs(session(), ['export list', 'export all'])).toEqual([
      [
        'Configured exports:',
        "  'Height Output       ' -> <project> <name>-<res>.png",
        "  'Material Output     ' -> <project> <name> <res>.png",
        "  'Colormap only       ' -> <project> <name> <res>.png",
        "  'Splatmap            ' -> <project> <name> <res>.png",
      ],
      ["Error: Error: Some output devices are not built. Run 'build' first, then export."],
    ]);
  });

  it('exports into the folder of the saved project after a full build (fact 50)', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'fake-wm-export-'));
    const s = session({ FAKE_WM_BUILD_MS: '50' });
    await outputs(s, [`project save ${folder}/fw.tmd`, 'build start']);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await outputs(s, ['export all'])).toEqual([
      [
        'Successfully exported 4 file(s):',
        `  ${folder}/fw Height Output-2049.png`,
        `  ${folder}/fw Material Output 2049.png`,
        `  ${folder}/fw Colormap only 2049.png`,
        `  ${folder}/fw Splatmap 2049.png`,
      ],
    ]);
  });

  it("refuses export all between a full build's Ended and its late Build started. (fact 54)", async () => {
    const folder = mkdtempSync(join(tmpdir(), 'fake-wm-export-'));
    const s = session({ FAKE_WM_BUILD_MS: '60000', FAKE_WM_BUILD_END_ON: 'export all' });
    await outputs(s, [`project save ${folder}/fw.tmd`, 'build start']);
    // raw/v2-build-export-timing.txt l.29-33: the build ends inside the export's frame, before its late line.
    expect(await outputs(s, ['export all'])).toEqual([
      ["Error: Error: Some output devices are not built. Run 'build' first, then export."],
    ]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await outputs(s, ['export all']))[0]?.[0]).toBe('Successfully exported 4 file(s):');
  });

  it("clears the other mode's end timer at a start (ruling R8)", async () => {
    const { proc, stream } = await streamed({ FAKE_WM_BUILD_MS: '600' });
    proc.write(['build start']);
    await waitUntil(() => stream.includes('<starting>'));
    await new Promise((resolve) => setTimeout(resolve, 400));
    proc.write(['build start tiled']);
    // The full build's own end would fall at 600 ms; the tiled build runs until about 1000 ms.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(stream).toEqual(['<sleep-prohibited>', '<starting>', '<sleep-prohibited>']);
    await waitUntil(() => stream.includes('<tiled-started>'));
    expect(stream).toEqual([
      '<sleep-prohibited>',
      '<starting>',
      '<sleep-prohibited>',
      '<sleep-allowed>',
      '<tiled-started>',
    ]);
  });
});

describe('fake World Machine: parameters and wires of added devices (spec v3 section 8)', () => {
  it("reads an added device's parameters and ports through the graph reader", async () => {
    const s = session();
    await s.execute(['project new blank force', 'device add Gradient', 'device add Combiner']);
    const reader = new WorldMachineGraphReader(s);
    expect(await reader.getDevice('#1')).toEqual({
      id: 1,
      name: 'Gradient',
      type: 'Gradient',
      enabled: true,
      bypassed: false,
      parameters: [
        { name: 'Direction', type: 'int', value: '0' },
        { name: 'Width', type: 'float', value: '8 km' },
        { name: 'Tiling', type: 'enum', value: 'Clamp' },
      ],
      inputs: [],
      outputs: [{ port: 1, name: 'Primary Output', targets: [] }],
    });
    expect((await reader.getDevice('#2')).inputs).toEqual([
      { port: 1, name: 'Primary Input' },
      { port: 2, name: 'Primary Input' },
    ]);
  });

  it('connects, refuses an occupied input and a missing port, disconnects, and drops wires with a device', async () => {
    const s = session();
    await s.execute([
      'project new blank force',
      'device add Gradient',
      'device add Gradient',
      'device add Combiner',
    ]);
    expect(
      await outputs(s, [
        'wire connect #1 #3.2',
        'wire connect #2 #3.2',
        'wire connect #1 #3.3',
        'wire disconnect #2 #3',
      ]),
    ).toEqual([
      ["Connected '#1' [1] -> '#3' [2]"],
      ["Error: Error: Input '#3.2' is already connected. Disconnect first."],
      ["Error: Error: Input port not found on '#3'"],
      ["Disconnected '#2' [1] -> '#3' [1]"],
    ]);
    const reader = new WorldMachineGraphReader(s);
    expect((await reader.getDevice('#3')).inputs[1]?.source).toEqual({ device: 'Gradient', port: 1 });
    expect((await reader.getDevice('#1')).outputs[0]?.targets).toEqual([{ device: 'Combiner', port: 2 }]);
    await s.execute(['device delete #1']);
    expect((await reader.getDevice('#3')).inputs[1]?.source).toBeUndefined();
  });

  it('keeps set values, and a snapshot restore brings back values and wires (assumption C1)', async () => {
    const s = session();
    await s.execute([
      'project new blank force',
      'device add Gradient',
      'device add Combiner',
      'wire connect #1 #2',
      'param set #1.Width 0.5',
      'param set #2.Clamp no',
      'snapshot create S',
    ]);
    expect(await outputs(s, ['param get #1.Width', 'param get #2.Clamp'])).toEqual([
      ['#1.Width = 0.5'],
      ['#2.Clamp = false'],
    ]);
    await s.execute([
      'param set #1.Width 0.9',
      'wire disconnect #1 #2',
      'device delete #2',
      'snapshot restore S',
    ]);
    const reader = new WorldMachineGraphReader(s);
    expect((await reader.getDevice('#1')).parameters[1]).toEqual({
      name: 'Width',
      type: 'float',
      value: '0.5',
    });
    expect((await reader.getDevice('#2')).inputs[0]?.source).toEqual({ device: 'Gradient', port: 1 });
  });

  it('fails the n-th param set and every restore on request', async () => {
    const s = session({ FAKE_WM_PARAM_SET_ERROR_AT: '2', FAKE_WM_RESTORE_ERROR: '1' });
    await s.execute(['project new blank force', 'device add Gradient', 'snapshot create S']);
    expect(
      await outputs(s, [
        'param set #1.Direction 1',
        'param set #1.Direction 2',
        'param get #1.Direction',
        'snapshot restore S',
      ]),
    ).toEqual([
      ['Set #1.Direction = 1'],
      ["Error: Error: Invalid value for '#1.Direction'"],
      ['#1.Direction = 1'],
      ["Error: Error: Could not restore snapshot 'S'"],
    ]);
  });

  it('confirms a rename of a Combiner and keeps its name (raw/v3-rename-probe.txt l.51-74, spec fact 80)', async () => {
    expect(
      await outputs(session(), [
        'project new blank force',
        'device add Combiner',
        'device add Gradient',
        'device rename #1 Mix',
        'device rename #2 Ramp',
        'device list',
      ]),
    ).toEqual([
      ['Created new blank project.'],
      ["Added 'Combiner'"],
      ["Added 'Gradient'"],
      ["Renamed '#1' to 'Mix'"],
      ["Renamed '#2' to 'Ramp'"],
      [
        'Devices (2 total):',
        '  #1     Combiner                ',
        '  #2     Ramp                     (Gradient)',
      ],
    ]);
  });

  it('adds a Combiner for an alias (raw/v3-rename-types.txt l.29-30 and l.558-559, spec fact 81)', async () => {
    const s = session();
    expect(
      await outputs(s, [
        'project new blank force',
        'device add Average',
        'device add Subtract',
        'device list',
      ]),
    ).toEqual([
      ['Created new blank project.'],
      ["Added 'Combiner'"],
      ["Added 'Combiner'"],
      ['Devices (2 total):', '  #1     Combiner                ', '  #2     Combiner                '],
    ]);
    const reader = new WorldMachineGraphReader(s);
    expect((await reader.getDevice('#1')).type).toBe('Combiner');
    expect((await reader.getDevice('#1')).inputs).toHaveLength(2);
  });

  it('names same-named devices at both ends of a wire, further targets on continuation lines (spec fact 82)', async () => {
    const s = session();
    await s.execute([
      'project new blank force',
      'device add Gradient',
      'device add Combiner',
      'device add Combiner',
      'device add Erosion',
      'wire connect #1 #2',
      'wire connect #2 #3',
      'wire connect #2 #4',
    ]);
    // raw/water-sea-erosion.txt l.164-166 and l.481: target and source lines; raw/v3-assumptions.txt l.82-86: the
    // continuation column.
    expect(await outputs(s, ['wire list #2', 'wire list #3'])).toEqual([
      [
        "Connections for '#2':",
        '  Inputs:',
        "    [1] Primary Input <- 'Gradient' [1]",
        '    [2] Primary Input <- (none)',
        '  Outputs:',
        "    [1] Primary Output -> 'Combiner' [1]",
        "                          -> 'Erosion' [1]",
      ],
      [
        "Connections for '#3':",
        '  Inputs:',
        "    [1] Primary Input <- 'Combiner' [1]",
        '    [2] Primary Input <- (none)',
        '  Outputs:',
        '    [1] Primary Output -> (none)',
      ],
    ]);
    expect((await new WorldMachineGraphReader(s).getDevice('#2')).outputs).toEqual([
      {
        port: 1,
        name: 'Primary Output',
        targets: [
          { device: 'Combiner', port: 1 },
          { device: 'Erosion', port: 1 },
        ],
      },
    ]);
  });
});

describe('fake World Machine: param set values on added devices (backlog item 49)', () => {
  it('rejects the values World Machine rejects and keeps the old value (raw/v6b-param-set.txt)', async () => {
    const s = session();
    await s.execute(['project new blank force', 'device add Gradient']);
    expect(
      await outputs(s, [
        'param set #1.Width 1.5 km',
        'param set #1.Width 1,5',
        'param get #1.Width',
        'param set #1.Direction 3.0',
        'param set #1.Direction 0.5',
        'param get #1.Direction',
        'param set #1.Tiling invalid-enum-value',
        'param set #1.Tiling 99',
        'param get #1.Tiling',
        'param set #1.width 1',
      ]),
    ).toEqual([
      ['Error: Error: Invalid float value: 1.5 km'],
      ['Error: Error: Invalid float value: 1,5'],
      ['#1.Width = 8 km'],
      ['Error: Error: Invalid integer value: 3.0'],
      ['Error: Error: Invalid integer value: 0.5'],
      ['#1.Direction = 0'],
      ['Error: Error: Invalid enum value: invalid-enum-value'],
      ['Error: Error: Enum index out of range (0-2): 99'],
      ['#1.Tiling = Clamp'],
      ["Error: Error: Parameter 'width' not found on device '#1'."],
    ]);
  });

  it('accepts the forms World Machine accepts and shows an enum by its label (raw/p2c-edits.txt)', async () => {
    const s = session();
    await s.execute(['project new blank force', 'device add Gradient']);
    expect(
      await outputs(s, [
        'param set #1.Width .5',
        'param set #1.Width 1e-1',
        'param set #1.Direction -1',
        'param set #1.Tiling 1',
        'param get #1.Tiling',
        'param set #1.Tiling clamp',
        'param get #1.Tiling',
      ]),
    ).toEqual([
      ['Set #1.Width = .5'],
      ['Set #1.Width = 1e-1'],
      ['Set #1.Direction = -1'],
      ['Set #1.Tiling = 1'],
      ['#1.Tiling = Mirrored Repeat'],
      ['Set #1.Tiling = clamp'],
      ['#1.Tiling = Clamp'],
    ]);
  });
});

describe('fake World Machine: parameter names with spaces (raw/river-device.txt)', () => {
  it('sets a spaced name only through a quoted reference and lists names longer than their column', async () => {
    const s = session();
    await s.execute(['project new blank force', 'device add River']);
    expect(
      await outputs(s, [
        'param set #1.Planform Type 1',
        'param set "#1.Planform Type" 1',
        'param get #1.Planform Type',
        'param set "#1.Planform Type" 2',
      ]),
    ).toEqual([
      ["Error: Error: Parameter 'Planform' not found on device '#1'."],
      ['Set #1.Planform Type = 1'],
      ['#1.Planform Type = Layout Alignment'],
      ['Error: Error: Enum index out of range (0-1): 2'],
    ]);
    const [listed] = await s.execute(['param list #1']);
    expect(parseParamList(listed?.output ?? [])).toContainEqual({
      name: 'Layout Alignment Uses Datum',
      type: 'bool',
      value: 'false',
    });
  });

  it('lets the parameter editor set spaced names', async () => {
    const s = session();
    await s.execute(['project new blank force', 'device add River']);
    const update = await new WorldMachineParameterEditor(s).updateParameters('#1', {
      'Planform Type': '1',
      'Layout Alignment Uses Datum': true,
      Sinuosity: 0.4,
    });
    expect(update.parameters.map((item) => [item.name, item.outcome, item.value])).toEqual([
      ['Planform Type', 'applied', 'Layout Alignment'],
      ['Layout Alignment Uses Datum', 'applied', 'true'],
      ['Sinuosity', 'applied', '0.4'],
    ]);
  });
});

describe('fake World Machine: a device without parameters (v1 fact 10)', () => {
  it('prints the captured line for a device without parameters (raw/enum-options.txt l.4097, l.4422)', async () => {
    const s = session();
    await s.execute(['project new blank force', 'device add Inverter', 'device add Macro']);
    expect(await outputs(s, ['param list #1', 'param list #2'])).toEqual([
      ["Device 'Inverter' has no parameters."],
      ["Device 'Macro' has no parameters."],
    ]);
  });

  it('lets get_device read a device without parameters', async () => {
    const s = session();
    await s.execute(['project new blank force', 'device add Inverter']);
    expect(await new WorldMachineGraphReader(s).getDevice('#1')).toMatchObject({
      id: 1,
      name: 'Inverter',
      type: 'Inverter',
      parameters: [],
    });
  });

  it('refuses update_device_parameters on a device without parameters, saying it has none', async () => {
    const s = session();
    await s.execute(['project new blank force', 'device add Inverter']);
    await expect(
      new WorldMachineParameterEditor(s).updateParameters('#1', { Strength: 0.5 }),
    ).rejects.toMatchObject({
      code: 'REFUSED',
      message: "Nothing was set on #1 'Inverter': 'Strength': no such parameter. It has no parameters",
    });
  });
});

describe('fake World Machine: device ids after a snapshot restore', () => {
  it('reuses the ids freed by a restore, as World Machine does (raw/v3-assumptions.txt l.311-336)', async () => {
    const s = session();
    await s.execute([
      'project new blank force',
      'device add Gradient',
      'snapshot create S',
      'device add Combiner',
    ]);
    await s.execute(['snapshot restore S', 'device add Gradient']);
    const reader = new WorldMachineGraphReader(s);
    expect((await reader.listDevices()).map((device) => device.id)).toEqual([1, 2]);
  });
});
