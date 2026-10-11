#!/usr/bin/env node
// Test double that speaks the World Machine --cli console over pipes. Errors go to stderr like the real one.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const env = process.env;
const record = (text) => {
  if (env.FAKE_WM_RECORD) appendFileSync(env.FAKE_WM_RECORD, `${text}\n`);
};
const out = (text) => process.stdout.write(text);
const log = (level, text) => out(`[${level.padEnd(11)}] ${text}\n`);
const fixture = (name) => readFileSync(join(env.FAKE_WM_FIXTURES, name), 'utf8');
const exit = (code) => {
  record('EXIT');
  process.exit(code);
};

record('START');
record(`PID ${process.pid}`);
log('Info', 'World Machine Program Log');
log('Info', 'License Manager.Checkout: License checkout successful (product wmpro)');
const startup = env.FAKE_WM_STARTUP ?? 'ok';
if (startup === 'exit') {
  log('Info', 'Startup: Loading plugins');
  out('fatal: simulated startup failure\n');
  exit(3);
}
if (startup === 'licence') {
  // Assumed: no capture shows a licence line outside the `[Level]` log form; this is the shape the filter must catch.
  out('License Manager.Checkout: denied\n');
  out('fatal: simulated startup failure\n');
  exit(3);
}
if (startup === 'display') {
  out('qt.qpa.xcb: could not connect to display \n');
  exit(1);
}
// Plain (non-log) lines printed during startup, for tests of which of them reach a START_FAILED detail.
if (env.FAKE_WM_STARTUP_OUT) out(`${env.FAKE_WM_STARTUP_OUT}\n`);
if (env.FAKE_WM_UNLICENSED === '1') {
  // Spec fact 53 (live probe, build 4067, no licence): the checkout fails, a modal activation dialog opens, and the
  // ready line never comes. The process stays alive until it is terminated.
  log('Error', 'License Manager.Checkout: License checkout failed for product wmpro');
  log('Error', 'License Manager.RLM Details: Wrong host for license (-4)');
  out('Wrong host (-193): _check_rehost(): No rehostable root dir\n');
  log('Info', 'Startup: License manager checkout (LICENSE_RESULT 3)');
  log('Info', 'Startup: License Activation');
}
// FAKE_WM_RECOVERY_DIALOG=<ms>: the 'Recover crashed session' dialog (live probe, 2026-10-06) is open for that long
// after the session check, then answered with OK; World Machine prints nothing while it is open. `never`: the dialog
// is never answered and nothing is read from the console. Assumed: it ends when the console closes, so a failed test
// leaves no process behind; the probe did not show what World Machine does then.
const recoveryDialog = env.FAKE_WM_RECOVERY_DIALOG;
if (startup === 'ok' && env.FAKE_WM_UNLICENSED !== '1' && recoveryDialog !== undefined) {
  log('Info', 'Checking for session and autosave files');
  if (recoveryDialog === 'never') {
    process.stdin.on('end', () => exit(0));
    process.stdin.resume();
    await new Promise(() => undefined);
  }
  await sleep(Number(recoveryDialog));
  log('Info', 'Session: adopting crash-recovery data from session-1233745');
  log(
    'Info',
    'Autosave: Restoring from /fake-home/.config/WorldMachineCurrent/temp/session-1242908/autosave.tmd',
  );
  log('Info', 'Open Project from file');
}
if (startup === 'ok' && env.FAKE_WM_UNLICENSED !== '1')
  log('Info', 'Startup: Completed. Transferring control into event loop.');

let hung = false;
let dirty = env.FAKE_WM_DIRTY_AT_START === '1';
// FAKE_WM_STARTUP_UNSAVED=1: the start-up project counts as unsaved until the first project switch, so `project open`
// without `force` is refused. Source: capture default-updated (wm-4067), where the freshly started World Machine
// carried state from the previous session and refused an unforced open.
let stoppedBuild = false;
let startupUnsaved = env.FAKE_WM_STARTUP_UNSAVED === '1';
// undefined, SAMPLE_EROSION, or a device from `added`.
let selected;
// 'sample' is the 17-device startup project; 'empty' follows a blank project, a close, or a failed open.
let project = 'sample';
// Devices added with `device add`, listed after the project's own devices.
let added = [];
// Wires between added devices, by id: { from, fromPort, to, toPort }. Assumed: wires of the sample project's own
// devices are not modelled; `wire list Erosion` answers from its fixture.
let wires = [];
// `param set` commands handled so far, for FAKE_WM_PARAM_SET_ERROR_AT.
let paramSets = 0;
// First new id: #1 in a blank project (raw/p2b-graph-edits.txt); #536 in the sample project, whose highest id is
// #373 (spec fact 30: three adds gave #536, #537, #538).
// Assumed: ids after those continue by one; `project open` of any file (which the fake answers with the sample
// project) also starts again at #536. Neither is captured.
const firstFreeId = (next) => (next === 'sample' ? 536 : 1);
let nextId = firstFreeId(project);
// Spec v2b facts 63-64 (raw/v2b-groups.txt l.16-56): the sample project's groups. Members are captured only for
// 'Create your Terrain' (l.34-56). Assumed: the other groups' members are not modelled, so enabling or disabling one
// prints its captured count and changes no device.
const SAMPLE_GROUPS = [
  { name: 'Create your Terrain', count: 6, members: [2, 3, 35, 305, 314, 319] },
  // raw/v2b-assumptions.txt l.159-169: a build of 'Export Basics' exports the File Output #1 whose exportAlways is
  // set, so the group includes it; the builds of groups #0, #2, and #4 (l.143-200) do not export it.
  { name: 'Export Basics', count: 4, members: [], exportsOutput: true },
  { name: 'Texture & View', count: 5, members: [] },
  { name: 'Welcome to World Machine!', count: 0, members: [] },
  { name: 'Material Maps', count: 2, members: [] },
];
// Ids of the sample project's own devices that a group disable turned off (fact 64); `device list` marks them.
let sampleDisabled = new Set();
// Spec v2b facts 57-61: the open project's snapshots, each with the fake's graph state at its creation, and the
// snapshots each saved file holds. Snapshots live in the `.tmd` file (fact 59), so `project open` brings back only the
// ones that existed at that file's last save.
let snapshots = [];
const savedSnapshots = new Map();
// Builds and exports (spec v2a facts 42-50). Assumed: a full or tiled build takes FAKE_WM_BUILD_MS and a preview
// FAKE_WM_PREVIEW_MS; real durations depend on the project and the resolution.
const BUILD_MS = Number(env.FAKE_WM_BUILD_MS ?? '100');
const PREVIEW_MS = Number(env.FAKE_WM_PREVIEW_MS ?? '100');
// Assumed: the late confirmations arrive FAKE_WM_LATE_MS (default 20 ms) after the build ended; captures show them a
// second or more later (raw/v2-build-export-timing.txt l.37-38).
const LATE_MS = Number(env.FAKE_WM_LATE_MS ?? '20');
// raw/v2-build-export.txt l.15-20: the default project's outputs and templates.
const EXPORT_ROWS = [
  ['Height Output', '<project> <name>-<res>.png'],
  ['Material Output', '<project> <name> <res>.png'],
  ['Colormap only', '<project> <name> <res>.png'],
  ['Splatmap', '<project> <name> <res>.png'],
];
// Assumed: the fake does not model `scene resolution`; `<res>` is the resolution of fixtures/wm-4067/scene-show.txt.
const FAKE_RESOLUTION = 2049;
// undefined, or { mode: 'full' | 'tiled', timer } while a build runs.
let build;
let previewUntil = 0;
// Fact 50: `export all` refuses outputs that were not built since the project changed. Fact 54
// (raw/v2-build-export-timing.txt l.29-41): they count as built only from the full build's late `Build started.`.
// Assumed: only a full build that ends makes them built, and only a project switch makes them unbuilt again.
let built = false;
// The `.tmd` file that `project save` or `project open` named; templates resolve against its folder (fact 50).
let savedPath;
// FAKE_WM_LATE_TRAILER=1 holds an ended full build's sleep-allowed trailer until the next build start prints its
// opening events (raw/v2-build-long.txt l.57-60 shows it after the next run's Starting). Assumed: the same order when
// the next build is tiled.
const LATE_TRAILER = env.FAKE_WM_LATE_TRAILER === '1';
let trailerHeld = false;
// FAKE_WM_START_DELAY_MS prints a start's opening events that long after its frame. Assumed: captures show them
// inside the frame; the knob lets a test act while a start waits for its confirmation.
const START_DELAY_MS = Number(env.FAKE_WM_START_DELAY_MS ?? '0');
// raw/v2-build-concurrency.txt l.164-170 and l.202-210: a stopped tiled build's `Tiled build started.` is printed
// only when the next tiled build ends, together with that build's own.
let tiledConfirmationsOwed = 0;
// FAKE_WM_GUI_BUILD=<full|tiled> starts a build as if from the World Machine window the first time the fake handles
// the command named by FAKE_WM_GUI_BUILD_ON. Assumed (spec assumption A1): a window build prints the same lines as
// one started from the console.
let guiBuildStarted = false;
// Facts 51 and 55: File Output #1's exportAlways; FAKE_WM_EXPORT_ALWAYS=1 sets it as if in the window, and
// `param set #1.exportAlways <value>` sets it (raw/v2b-assumptions.txt l.123-124). Assumed: a project switch reads
// it from FAKE_WM_EXPORT_ALWAYS again.
let outputExportAlways = env.FAKE_WM_EXPORT_ALWAYS === '1';
// Spec v2b fact 71 (raw/v2b-assumptions.txt l.159-162): with exportAlways set, a build that includes File Output #1
// exports its file inside the start frame, after Starting. Assumed: a full build includes it and prints the same
// line at the same place; no capture shows a full build with exportAlways set. The fake writes no file.
const automaticExport = (group) => {
  if (!outputExportAlways || (group !== undefined && !group.exportsOutput)) return;
  const folder = savedPath === undefined ? '/fake-home/Documents/WorldMachine' : dirname(savedPath);
  const name = savedPath === undefined ? 'New Project' : basename(savedPath).replace(/\.tmd$/i, '');
  event(`Automatic export of file ${join(folder, `${name} Height Output-${FAKE_RESOLUTION}.png`)} succeeded`);
};
const event = (text) => out(`[Build Event] ${text}\n`);
const later = (action) => setTimeout(action, LATE_MS);
const trailer = () => {
  if (LATE_TRAILER) trailerHeld = true;
  else event('System allowed to sleep again');
};
const releaseTrailer = () => {
  if (!trailerHeld) return;
  trailerHeld = false;
  event('System allowed to sleep again');
};
const opening = (print) => {
  if (START_DELAY_MS > 0) setTimeout(print, START_DELAY_MS);
  else print();
};
// `group` is a group build of group #0 (spec v2b section 5: the window can start one; assumed to print the same
// lines as `group build`).
const startGuiBuild = (mode) => {
  guiBuildStarted = true;
  previewUntil = 0;
  event('Prohibiting system sleep');
  if (mode !== 'tiled') event('*** Build Starting ***');
  const group = mode === 'group' ? SAMPLE_GROUPS[0] : undefined;
  build = { mode: mode === 'tiled' ? 'tiled' : 'full', group, timer: setTimeout(endBuild, BUILD_MS) };
};
const endBuild = () => {
  const ending = build;
  if (ending === undefined) return;
  clearTimeout(ending.timer);
  build = undefined;
  if (ending.mode === 'full') {
    // Fact 43, raw/v2-build-isolate.txt l.61-68; a group build, raw/v2b-groups.txt l.274-283.
    event('*** Build Ended ***');
    trailer();
    later(() => {
      // Spec v2b fact 67: a group build does not make the outputs exportable.
      if (ending.group === undefined) built = true;
      out(lateLine(ending));
    });
  } else {
    // Fact 48, raw/v2-build-isolate.txt l.84-85.
    event('System allowed to sleep again');
    const confirmations = tiledConfirmationsOwed + 1;
    tiledConfirmationsOwed = 0;
    later(() => out('Tiled build started.\n'.repeat(confirmations)));
  }
};
// The late line of a full run: `Build started.` (fact 54), or a group build's own (spec v2b fact 66).
const lateLine = (run) =>
  run.group === undefined
    ? 'Build started.\n'
    : `Building ${run.group.count} device(s) in group '${run.group.name}'\n`;
// `build start`, or `group build` with its group: the same events (spec v2b fact 66).
const startFull = (group) => {
  // Spec v2a section 3: a full build replaces a preview; raw/v2-build-concurrency.txt l.85-86 reads
  // `No build running.` during it.
  previewUntil = 0;
  if (build?.mode === 'full') {
    // Fact 45, raw/v2-build-long.txt l.57-60: the running build ends and a new one starts in the same frame.
    clearTimeout(build.timer);
    opening(() => {
      event('*** Build Ended ***');
      event('Prohibiting system sleep');
      event('*** Build Starting ***');
      event('System allowed to sleep again');
      automaticExport(group);
    });
  } else {
    // Assumed: no capture shows a start of one mode while a build of the other mode runs; the running build's own
    // end timer is dropped so its late end cannot arrive after the new build's events.
    if (build !== undefined) clearTimeout(build.timer);
    // Fact 43, raw/v2-build-isolate.txt l.54-56.
    opening(() => {
      event('Prohibiting system sleep');
      event('*** Build Starting ***');
      releaseTrailer();
      automaticExport(group);
    });
  }
  build = { mode: 'full', group, timer: setTimeout(endBuild, BUILD_MS) };
};
const switchTo = (next) => {
  project = next;
  selected = undefined;
  dirty = false;
  startupUnsaved = false;
  added = [];
  wires = [];
  nextId = firstFreeId(next);
  built = false;
  savedPath = undefined;
  sampleDisabled = new Set();
  snapshots = [];
  outputExportAlways = env.FAKE_WM_EXPORT_ALWAYS === '1';
};
// Spec fact 30: the name is the type, without de-duplication (two `device add Gradient` give two devices named
// 'Gradient'; `device add Erosion` gives 'Erosion', raw/p2b-kind-markers.txt). Captured exception,
// raw/v6b-param-set.txt l.13-14: `device add File Output` names the device 'Height Output'.
// raw/v3-assumptions.txt l.435-472 (spec fact 79): Layout Generator is named and typed 'Shapes'.
const DEFAULT_NAMES = { 'File Output': 'Height Output', 'Layout Generator': 'Shapes' };
// Ports and parameters of added devices (plan v3 decision D19). raw/p2a-edge-cases.txt l.38-42 and l.59-63: a
// Gradient has no inputs, one output, and Direction, Width, and Tiling. raw/p2b-graph-edits.txt l.25-31: a Combiner
// has two inputs named 'Primary Input' and one output. Assumed: the Combiner's parameters (not captured), and for
// every other type one input named 'Primary Input' and no parameters. Every device has one output.
const SHAPES = {
  Gradient: {
    inputs: [],
    parameters: [
      ['Direction', 'int', '0'],
      ['Width', 'float', '8 km'],
      ['Tiling', 'enum', 'Clamp'],
    ],
  },
  Combiner: {
    inputs: ['Primary Input', 'Primary Input'],
    parameters: [
      ['Method', 'enum', 'Average'],
      ['Strength', 'float', '0.5'],
      ['Clamp', 'bool', 'true'],
    ],
  },
};
const OTHER_SHAPE = { inputs: ['Primary Input'], parameters: [] };
// Assumed: World Machine shows a bool as true or false. Any other value is kept as sent, so the fake shows no display
// units for a float (fact 18) and no label for an enum index.
const shownValue = (type, text) =>
  type === 'bool' ? String(['true', '1', 'yes', 'on'].includes(text.toLowerCase())) : text;
// raw/p2a-edge-cases.txt l.59-64: the header names the device and its type; rows pad the name to 26 and the type to 10.
const paramList = (device) =>
  `Parameters for '${device.name}' (${device.type}):\n${device.parameters
    .map((parameter) => `  ${parameter.name.padEnd(26)}${parameter.type.padEnd(10)}${parameter.value}\n`)
    .join('')}\n`;
// raw/p2b-graph-edits.txt l.25-32: the header echoes the reference and port names are padded to 12; a further target
// of one output continues on its own line. Ends show current names (fact 34).
const nameOfId = (id) => findAdded(`#${id}`)?.name ?? `#${id}`;
const wireList = (ref, device) => {
  const inputs = device.inputs.map((name, index) => {
    const wire = wires.find((candidate) => candidate.to === device.id && candidate.toPort === index + 1);
    const source = wire === undefined ? '(none)' : `'${nameOfId(wire.from)}' [${wire.fromPort}]`;
    return `    [${index + 1}] ${name.padEnd(12)} <- ${source}\n`;
  });
  const targets = wires.filter((wire) => wire.from === device.id);
  const [first, ...more] = targets.map((wire) => `'${nameOfId(wire.to)}' [${wire.toPort}]`);
  // raw/v3-assumptions.txt l.82-86: further targets of 'Primary Output' continue 26 spaces in.
  const continued = more.map((target) => `${' '.repeat(26)}-> ${target}\n`).join('');
  return `Connections for '${ref}':\n  Inputs:\n${inputs.join('')}  Outputs:\n    [1] ${'Primary Output'.padEnd(12)} -> ${first ?? '(none)'}\n${continued}\n`;
};
// raw/device-list-sample.txt: two spaces, "#<id>" padded to 7, the name padded to 24. A device whose name differs
// from its type adds " (<type>)" (raw/v4-quoting.txt l.16-18), a disabled one " [disabled]" after that
// (raw/p2b-graph-edits.txt l.48-51, raw/p2b-kind-markers.txt l.97). Spec fact 32: the kind appears when the name
// differs from the type and goes away when the device is renamed back (raw/p2c-edits.txt l.36, l.80).
// Assumed: the comparison is case-sensitive; no capture renames a device to its type in another case.
const deviceRow = ({ id, name, type, enabled }) =>
  `  ${`#${id}`.padEnd(7)}${name.slice(0, 23).padEnd(24)}${name === type ? '' : ` (${type})`}${enabled ? '' : ' [disabled]'}`;
// The name of a row in that format (names are cut to 23 characters, raw/p2c-edits.txt l.50-69, spec fact 33).
const nameOfRow = (row) => row.slice(9, 33).trimEnd();
const splitOnce = (text) => {
  const space = text.indexOf(' ');
  return space === -1 ? [text, ''] : [text.slice(0, space), text.slice(space + 1)];
};
const NO_DEVICE_SELECTED =
  "Error: Error: No device selected. Use 'param set <device>.<param> <value>' or select a device first.\n";
const ERODE = new Set(['Erosion', '#35']);
const isErosion = (ref) => project === 'sample' && ERODE.has(ref);
const notFound = (ref) => process.stderr.write(`Error: Error: Device not found: '${ref}'\n`);
const SAMPLE_EROSION = { id: 35, name: 'Erosion', type: 'Erosion', enabled: true };
// Spec fact 31: `device select` matches names regardless of case (raw/p2b-kind-markers.txt l.122-123).
const selectsSampleErosion = (ref) =>
  project === 'sample' && (ref === '#35' || ref.toLowerCase() === 'erosion');
// An added device by `#<id>`, or by name regardless of case (spec fact 31).
// Assumed: with several devices of one name, the first added one is meant; no capture shows which one World Machine
// picks. Assumed: enable, disable, rename, and delete match names the way `device select` does.
const findAdded = (ref) => {
  const id = /^#(\d+)$/.exec(ref);
  return added.find((device) =>
    id ? device.id === Number(id[1]) : device.name.toLowerCase() === ref.toLowerCase(),
  );
};
// Spec v2b fact 57: the time a snapshot was made, as `snapshot list` prints it.
const minuteStamp = () => {
  const now = new Date();
  const two = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())} ${two(now.getHours())}:${two(now.getMinutes())}`;
};
// What a snapshot holds of the fake's graph (fact 60). Spec v3 assumption C1 (fact 78 once captured): parameter values
// and wires too. Assumed: a restore also clears the selection.
const copyDevice = (device) => ({
  ...device,
  parameters: device.parameters.map((parameter) => ({ ...parameter })),
});
const graphState = () => ({
  added: added.map(copyDevice),
  wires: wires.map((wire) => ({ ...wire })),
  disabled: [...sampleDisabled],
});
const restoreGraphState = (state) => {
  added = state.added.map(copyDevice);
  wires = state.wires.map((wire) => ({ ...wire }));
  sampleDisabled = new Set(state.disabled);
  selected = undefined;
};
// A reference to an item of `items` by `#<index>` or by name (spec v2b facts 58, 61, and 65), or undefined after
// printing World Machine's error. `sameName` compares a listed name with the reference.
const lookUpIndexed = (items, ref, what, sameName) => {
  const byIndex = /^#(\d+)$/.exec(ref);
  if (byIndex) {
    const index = Number(byIndex[1]);
    if (index < items.length) return index;
    // Assumed: the range reads `#0 - #-1` for an empty list; no capture shows one.
    process.stderr.write(
      `Error: Error: Invalid ${what.toLowerCase()} index: #${index} (valid range: #0 - #${items.length - 1})\n`,
    );
    return undefined;
  }
  const matches = items.flatMap((item, index) => (sameName(item.name, ref) ? [index] : []));
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) {
    process.stderr.write(`Error: Error: ${what} not found: '${ref}'\n`);
    return undefined;
  }
  // raw/v2b-snapshots.txt l.100-104. Groups never get here: the sample groups have distinct names (assumption B4).
  const rows = matches.map((index) => `  [#${index}] '${ref}'\n`).join('');
  process.stderr.write(
    `Error: Error: Multiple snapshots match '${ref}':\n${rows}Use #index to specify which one.\n`,
  );
  return undefined;
};
// Snapshot names compare exactly (spec v2b section 4); group names regardless of case (fact 64, l.260-261).
const snapshotIndex = (ref) => lookUpIndexed(snapshots, ref, 'Snapshot', (name, wanted) => name === wanted);
const groupIndex = (ref) =>
  lookUpIndexed(
    project === 'empty' ? [] : SAMPLE_GROUPS,
    ref,
    'Group',
    (name, wanted) => name.toLowerCase() === wanted.toLowerCase(),
  );
let quitting = false;
let partial = '';
let pending = [];
const work = [];
let draining = false;
// Assumed: World Machine reads console input that arrives before its ready line once it gets to it, so a start that
// never becomes ready (FAKE_WM_STARTUP=silent) still answers commands. No capture shows input before the ready line.

// Spec facts 14-15: a read handles leftover lines plus only the first new line; the rest waits for the next read.
process.stdin.on('data', (chunk) => {
  const parts = (partial + chunk.toString()).split('\n');
  partial = parts.pop() ?? '';
  work.push(...pending, ...parts.slice(0, 1));
  pending = parts.slice(1);
  void drain();
});
// Like the real one, a quit already in progress is not cut short by the console closing.
process.stdin.on('end', () => {
  if (!quitting) exit(0);
});

async function drain() {
  if (draining) return;
  draining = true;
  while (work.length > 0) await handle(work.shift());
  draining = false;
}

async function handle(line) {
  record(line);
  const command = line.trim();
  if (hung || command === '') return;
  if (command === env.FAKE_WM_HANG_ON) {
    hung = true;
    return;
  }
  if (command === env.FAKE_WM_CRASH_ON) exit(139);
  // Prints nothing for this exact command, so a confirmation line is missing.
  if (command === env.FAKE_WM_SILENT_ON) return;
  if (command === env.FAKE_WM_DELAY_ON) await sleep(Number(env.FAKE_WM_DELAY_MS ?? '0'));
  // Fact 47: a running build's end events can land inside another command's frame, before its answer.
  if (command === env.FAKE_WM_BUILD_END_ON) endBuild();
  if (command === env.FAKE_WM_GUI_BUILD_ON && !guiBuildStarted && build === undefined) {
    startGuiBuild(['tiled', 'group'].includes(env.FAKE_WM_GUI_BUILD) ? env.FAKE_WM_GUI_BUILD : 'full');
  }
  if (command === 'system quit force') {
    if (dirty) {
      // Spec fact 19: a modified project opens a modal dialog that blocks the console.
      record('DIALOG');
      hung = true;
      return;
    }
    quitting = true;
    out('Exiting World Machine...\n');
    // Assumed: FAKE_WM_QUIT_HANG_AFTER_STOP=1 mirrors spec fact 75 (live probe, 2026-10-06): after a `build stop` the quit
    // prints its line and then never ends; only a signal does. Real World Machine hung for 120 s at resolution 4097.
    if (env.FAKE_WM_QUIT_HANG_AFTER_STOP === '1' && stoppedBuild) return;
    log('Info', 'License Manager.Checkin: License returned to license server');
    await sleep(Number(env.FAKE_WM_QUIT_DELAY_MS ?? '0'));
    exit(0);
  }
  if (command === 'system info') {
    out(fixture('system-info.txt'));
    return;
  }
  if (command === 'device list' || command.startsWith('device list ')) {
    if (project === 'empty' && added.length === 0) return void out('No devices in the current project.\n');
    const lines =
      project === 'empty' ? ['Devices (0 total):', '', ''] : fixture('device-list.txt').split('\n');
    // Spec v2b fact 64, raw/v2b-groups.txt l.38-55: a sample device a group disabled gets ` [disabled]`.
    for (const [index, line] of lines.entries()) {
      const id = /^ {2}#(\d+) /.exec(line)?.[1];
      if (project === 'sample' && id !== undefined && sampleDisabled.has(Number(id))) {
        lines[index] = `${line} [disabled]`;
      }
    }
    if (added.length > 0) {
      const total = Number(/\((\d+) total\)/.exec(lines[0])[1]) + added.length;
      lines[0] = `Devices (${total} total):`;
      const end = lines.findLastIndex((line) => line.startsWith('  #')) + 1;
      lines.splice(end === 0 ? 1 : end, 0, ...added.map(deviceRow));
    }
    // Spec fact 16: a filter keeps the unfiltered total in the header. Captured filters (raw/device-list-sample.txt
    // l.22-25, raw/p2b-kind-markers.txt l.110-119) keep the rows whose name contains them.
    // Assumed: the match is case-sensitive and may start anywhere in the name; no capture shows either.
    const filter = command.slice('device list'.length).trim();
    const shown =
      filter === ''
        ? lines
        : lines.filter((line) => !line.startsWith('  #') || nameOfRow(line).includes(filter));
    if (env.FAKE_WM_INTERLEAVE === '1')
      shown.splice(3, 0, '[Info       ] QIODevice::read (QSslSocket): device not open');
    out(shown.join('\n'));
    return;
  }
  // Outputs as captured in test/fixtures/wm-4067/raw (V3, V7).
  if (command.startsWith('project open ')) {
    if (startupUnsaved && !command.endsWith(' force')) {
      process.stderr.write(
        "Error: Error: Project has unsaved changes. Use 'project save' first or 'project open <path> force'.\n",
      );
      return;
    }
    if (env.FAKE_WM_OPEN_ERROR) {
      // Spec fact 17: a failed open leaves an empty project.
      switchTo('empty');
      out('Failed to open project.\n');
    } else {
      switchTo('sample');
      savedPath = command.slice('project open '.length).replace(/ force$/, '');
      // Spec v2b fact 59: the file holds the snapshots of its last save. Assumed: the fake's graph state is not saved,
      // so the opened project is the sample project with those snapshots.
      snapshots = [...(savedSnapshots.get(savedPath) ?? [])];
      out(`Opened: ${savedPath}\n`);
    }
    return;
  }
  if (command.startsWith('project new default') || command.startsWith('project new blank')) {
    // raw/v2b-snapshots.txt l.285-286: without force, an unsaved project refuses a new one.
    if (dirty && !command.endsWith(' force')) {
      process.stderr.write(
        "Error: Error: Project has unsaved changes. Use 'project save' first or 'project new force'.\n",
      );
      return;
    }
    const blank = command.includes('blank');
    switchTo(blank ? 'empty' : 'sample');
    out(`Created new ${blank ? 'blank' : 'default'} project.\n`);
    return;
  }
  if (command === 'project close force') {
    switchTo('empty');
    out('Project closed.\n');
    return;
  }
  if (command.startsWith('project save ')) {
    const target = command.slice('project save '.length);
    if (env.FAKE_WM_SAVE_SILENT !== '1') {
      try {
        writeFileSync(target, 'fake tmd\n');
      } catch {
        // Spec fact 23: World Machine reports success even when nothing is written.
      }
    }
    dirty = false;
    savedPath = target;
    savedSnapshots.set(target, [...snapshots]);
    out(`Project saved to: ${target}\n`);
    return;
  }
  if (command === 'project undo' || command === 'project redo') {
    // Not modelled: undo only marks the project unsaved; it does not revert a snapshot restore or a group enable or
    // disable (facts 60, 64).
    dirty = true;
    out(command === 'project undo' ? 'Undo performed.\n' : 'Redo performed.\n');
    return;
  }
  if (command.startsWith('param set ')) {
    // raw/v6b-param-set.txt l.54-61 and l.195-196: World Machine drops the quotes around a reference or a value.
    // Assumed: any `<device>.<param>` reference is echoed as a success, an unknown device or parameter included;
    // no capture shows World Machine's answer for those.
    const args = command.slice('param set '.length);
    let target;
    let value;
    if (args.startsWith('"')) {
      const close = args.indexOf('"', 1);
      const [rest, after] = splitOnce(args.slice(close + 1));
      target = args.slice(1, close) + rest;
      value = after;
    } else {
      [target, value] = splitOnce(args);
    }
    if (!target.includes('.')) {
      // raw/v6-param-values.txt l.56-57: the first word of an unquoted name with a space has no dot, and World
      // Machine reads it as a parameter of the selected device (raw/v6b-param-set.txt l.75-76).
      if (selected === undefined) return void process.stderr.write(NO_DEVICE_SELECTED);
      target = `${selected.name}.${target}`;
    }
    paramSets++;
    if (Number(env.FAKE_WM_PARAM_SET_ERROR_AT) === paramSets) {
      // Assumed text: no capture shows World Machine rejecting a value of a settable type this way.
      return void process.stderr.write(`Error: Error: Invalid value for '${target}'\n`);
    }
    dirty = true;
    if (target === '#1.exportAlways' && project === 'sample') outputExportAlways = value === 'true';
    const shown = value.replace(/^"(.*)"$/, '$1');
    const dot = target.indexOf('.');
    const parameter = findAdded(target.slice(0, dot))?.parameters.find(
      (p) => p.name === target.slice(dot + 1),
    );
    if (parameter !== undefined) parameter.value = shownValue(parameter.type, shown);
    out(`Set ${target} = ${shown}\n`);
    return;
  }
  if (command.startsWith('param get ')) {
    // raw/v2-build-isolate.txt l.17-42: `<reference> = <value>`. Other references fall through to the handlers below.
    const target = command.slice('param get '.length);
    const dot = target.indexOf('.');
    const device = dot === -1 ? undefined : findAdded(target.slice(0, dot));
    const parameter = device?.parameters.find((p) => p.name === target.slice(dot + 1));
    if (parameter !== undefined) return void out(`${target} = ${parameter.value}\n`);
  }
  if (command.startsWith('device add ')) {
    // World Machine rejects an unknown type (raw/p2c-edits.txt l.17-18, spec fact 32). The fake has no list of
    // types, so it accepts every type; tests that need the rejection use a scripted session.
    const type = command.slice('device add '.length);
    const name = DEFAULT_NAMES[type] ?? type;
    // Assumed: the type `device info` and `device list` show for `File Output` is 'Height Output', as the
    // `param list` header of raw/v6b-param-set.txt l.39 shows; no capture shows its `device info`.
    const shape = SHAPES[type] ?? OTHER_SHAPE;
    const device = {
      id: nextId++,
      name,
      type: name,
      enabled: true,
      inputs: shape.inputs,
      parameters: shape.parameters.map(([parameter, kind, value]) => ({
        name: parameter,
        type: kind,
        value,
      })),
    };
    added.push(device);
    dirty = true;
    out(`Added '${device.name}'\n`);
    return;
  }
  if (command.startsWith('device select ')) {
    const ref = command.slice('device select '.length);
    const device = selectsSampleErosion(ref) ? SAMPLE_EROSION : findAdded(ref);
    if (device === undefined) return void notFound(ref);
    selected = device;
    out(`Selected: ${device.name}\n`);
    return;
  }
  if (command === 'device info') {
    if (selected === undefined) return void out('No device selected.\n');
    if (selected === SAMPLE_EROSION) return void out(fixture('device-info-erosion.txt'));
    // raw/p2a-edge-cases.txt l.48-54, raw/p2b-graph-edits.txt l.40-46. Bypass is not modelled.
    out(
      `Selected device:\n  Name:    ${selected.name}\n  Type:    ${selected.type}\n` +
        `  Enabled: ${selected.enabled ? 'yes' : 'no'}\n  Bypass:  no\n\n`,
    );
    return;
  }
  // raw/p2b-graph-edits.txt l.34-35, 57-58, 150-151: the reference is echoed as given.
  // Assumed: only devices added with `device add` change; any other reference, including the sample project's own
  // devices, which the fake does not model, prints the not-found error of raw/p2b-graph-edits.txt l.108-115.
  const stateChange = /^device (enable|disable|delete) (.+)$/.exec(command);
  if (stateChange) {
    const [, verb, ref] = stateChange;
    const device = findAdded(ref);
    if (device === undefined) return void notFound(ref);
    dirty = true;
    if (verb === 'delete') {
      added = added.filter((other) => other !== device);
      // Fact 34: deleting a device removes its wires.
      wires = wires.filter((wire) => wire.from !== device.id && wire.to !== device.id);
      // Assumed: deleting the selected device clears the selection.
      if (selected === device) selected = undefined;
      return void out(`Deleted: ${ref}\n`);
    }
    device.enabled = verb === 'enable';
    out(`${verb === 'enable' ? 'Enabled' : 'Disabled'}: ${ref}\n`);
    return;
  }
  if (command.startsWith('device rename ')) {
    // raw/v4-quoting.txt l.13-14 and l.70-71: the new name is the final argument and may contain spaces; the
    // reference is echoed as given. The fake reads the reference as the first word (Plan 2c sends `#<id>`).
    const [ref, name] = splitOnce(command.slice('device rename '.length));
    const device = findAdded(ref);
    if (device === undefined) return void notFound(ref);
    device.name = name;
    dirty = true;
    out(`Renamed '${ref}' to '${name}'\n`);
    return;
  }
  if (command.startsWith('param list ') || command.startsWith('wire list ')) {
    const wire = command.startsWith('wire list ');
    const ref = command.slice((wire ? 'wire list ' : 'param list ').length);
    if (isErosion(ref)) return void out(fixture(wire ? 'wire-list-erosion.txt' : 'param-list-erosion.txt'));
    const device = findAdded(ref);
    if (device === undefined) return void notFound(ref);
    return void out(wire ? wireList(ref, device) : paramList(device));
  }
  const wireEdit = /^wire (connect|disconnect) (\S+) (\S+)$/.exec(command);
  if (wireEdit) {
    const [, verb, sourceArg, destinationArg] = wireEdit;
    const end = (arg) => {
      const [ref, port] = arg.split('.');
      return { ref, port: port === undefined ? 1 : Number(port) };
    };
    const from = end(sourceArg);
    const to = end(destinationArg);
    const source = findAdded(from.ref);
    const destination = findAdded(to.ref);
    if (source === undefined) return void notFound(from.ref);
    if (destination === undefined) return void notFound(to.ref);
    // raw/p2c-edits.txt l.126-127 (fact 34).
    if (to.port < 1 || to.port > destination.inputs.length) {
      return void process.stderr.write(`Error: Error: Input port not found on '${to.ref}'\n`);
    }
    // Assumed text, modelled on the input's: every fake device has one output.
    if (from.port !== 1)
      return void process.stderr.write(`Error: Error: Output port not found on '${from.ref}'\n`);
    // raw/p2b-graph-edits.txt l.22-23 and l.117-118, raw/p2c-edits.txt l.108-109: references without their port.
    const ends = `'${from.ref}' [${from.port}] -> '${to.ref}' [${to.port}]`;
    const index = wires.findIndex(
      (wire) =>
        wire.from === source.id &&
        wire.fromPort === from.port &&
        wire.to === destination.id &&
        wire.toPort === to.port,
    );
    if (verb === 'disconnect') {
      // Fact 26: confirmed whether or not the wire existed. Assumed: only a removed wire is an unsaved change.
      if (index !== -1) {
        wires.splice(index, 1);
        dirty = true;
      }
      return void out(`Disconnected ${ends}\n`);
    }
    // raw/p2c-edits.txt l.105-106 (fact 34). Assumed: a reference with a port is echoed with it.
    if (wires.some((wire) => wire.to === destination.id && wire.toPort === to.port)) {
      return void process.stderr.write(
        `Error: Error: Input '${destinationArg}' is already connected. Disconnect first.\n`,
      );
    }
    wires.push({ from: source.id, fromPort: from.port, to: destination.id, toPort: to.port });
    dirty = true;
    return void out(`Connected ${ends}\n`);
  }
  if (command === 'build preview') {
    // Fact 42, raw/v2-build-export.txt l.22-23.
    previewUntil = Date.now() + PREVIEW_MS;
    return void out('Preview build started.\n');
  }
  if (command === 'build status') {
    // Facts 42 and 44: only a preview is reported.
    return void out(Date.now() < previewUntil ? 'Build in progress...\n' : 'No build running.\n');
  }
  if (command === 'build start') return void startFull(undefined);
  if (command === 'build start tiled') {
    // Assumed: a tiled build replaces a preview as a full build does.
    previewUntil = 0;
    // Assumed: no capture shows a start of one mode while a build of the other mode runs; the running build's own end
    // timer is dropped so its late end cannot arrive after the new build's events.
    if (build?.mode === 'full') clearTimeout(build.timer);
    // Fact 48, raw/v2-build-isolate.txt l.73-74: no Starting or Ended events.
    opening(() => {
      event('Prohibiting system sleep');
      releaseTrailer();
    });
    build = { mode: 'tiled', timer: setTimeout(endBuild, BUILD_MS) };
    return;
  }
  if (command === 'build stop') {
    // Fact 46: raw/v2-build-long.txt l.62-68 (full) and l.87-91 (preview), raw/v2-build-concurrency.txt
    // l.164-166 (tiled).
    out('Stop requested.\n');
    stoppedBuild = true;
    previewUntil = 0;
    const stopping = build;
    if (stopping === undefined) return;
    clearTimeout(stopping.timer);
    build = undefined;
    if (stopping.mode === 'full') {
      event('*** Build Ended ***');
      // The held trailer is recorded now, so a start right after the stop releases it; only printing waits.
      if (LATE_TRAILER) trailerHeld = true;
      else later(() => event('System allowed to sleep again'));
      // Spec v2b fact 72 (raw/v2b-assumptions.txt l.217-230): a stopped group build prints no late line.
      if (stopping.group === undefined) later(() => out(lateLine(stopping)));
    } else {
      event('System allowed to sleep again');
      tiledConfirmationsOwed++;
    }
    return;
  }
  if (command === 'export list') {
    // Fact 49, raw/v2-build-export.txt l.15-20. Assumed: a project without outputs prints the header and no rows.
    const rows = project === 'empty' ? [] : EXPORT_ROWS;
    out(
      `Configured exports:\n${rows.map(([name, template]) => `  '${name.padEnd(20)}' -> ${template}\n`).join('')}\n`,
    );
    return;
  }
  const exportAlways = /^param get #(\d+)\.exportAlways$/.exec(command);
  if (exportAlways && project === 'sample') {
    // raw/v2-build-isolate.txt l.17-42 (fact 51): the default project's File Output #1 reads its exportAlways; its
    // Material Output and Bitmap Outputs have none. FAKE_WM_EXPORT_ALWAYS=1 reads #1 as set in the window (fact 55).
    // Assumed: other ids are not modelled and get the unknown-command answer below.
    const [, id] = exportAlways;
    if (id === '1') return void out(`#1.exportAlways = ${outputExportAlways}\n`);
    if (['308', '309', '318'].includes(id)) {
      return void process.stderr.write(
        `Error: Error: Parameter 'exportAlways' not found on device '#${id}'.\n`,
      );
    }
  }
  if (command === 'export all') {
    // Fact 50: raw/v2-build-long.txt l.103-104 (not built), raw/v2-build-export.txt l.85-91.
    // Assumed: the fake prints the paths and writes no files.
    if (!built) {
      return void process.stderr.write(
        "Error: Error: Some output devices are not built. Run 'build' first, then export.\n",
      );
    }
    const folder = savedPath === undefined ? '/fake-home/Documents/WorldMachine' : dirname(savedPath);
    const name = savedPath === undefined ? 'New Project' : basename(savedPath).replace(/\.tmd$/i, '');
    const files = EXPORT_ROWS.map(([device, template]) =>
      join(
        folder,
        template
          .replace('<project>', name)
          .replace('<name>', device)
          .replace('<res>', String(FAKE_RESOLUTION)),
      ),
    );
    out(`Successfully exported ${files.length} file(s):\n${files.map((file) => `  ${file}\n`).join('')}\n`);
    return;
  }
  const blank = project === 'empty';
  if (command === 'scene show') return void out(fixture(blank ? 'scene-show-blank.txt' : 'scene-show.txt'));
  if (command === 'scene list') return void out(fixture(blank ? 'scene-list-blank.txt' : 'scene-list.txt'));
  // Spec v2b facts 57-61: raw/v2b-snapshots.txt and raw/v2b-snapshot-restore.txt.
  if (command === 'snapshot list' || command === 'snapshots') {
    if (snapshots.length === 0) return void out('No snapshots.\n');
    const rows = snapshots.map(
      (snapshot, index) => `  [#${index}] '${snapshot.name}' - ${snapshot.created}\n`,
    );
    return void out(`Snapshots (${snapshots.length} total):\n${rows.join('')}\n`);
  }
  if (command === 'snapshot create') {
    return void process.stderr.write('Error: Error: Usage: snapshot create <name>\n');
  }
  if (command.startsWith('snapshot create ')) {
    // Fact 58: any name is accepted, a repeated one too. Fact 59: a snapshot is not an unsaved change.
    const name = command.slice('snapshot create '.length);
    snapshots.push({ name, created: minuteStamp(), state: graphState() });
    return void out(`Created snapshot '${name}'\n`);
  }
  const snapshotChange = /^snapshot (restore|delete) (.+)$/.exec(command);
  if (snapshotChange) {
    const [, verb, ref] = snapshotChange;
    const index = snapshotIndex(ref);
    if (index === undefined) return;
    const snapshot = snapshots[index];
    if (verb === 'delete') {
      // Assumed: a delete is not an unsaved change (no capture checks it; a create is not one, fact 59).
      snapshots.splice(index, 1);
      return void out(`Deleted snapshot [#${index}] '${snapshot.name}'\n`);
    }
    // Fact 60: the graph goes back to the snapshot, later snapshots are kept, and the restore is an unsaved change.
    if (env.FAKE_WM_RESTORE_ERROR === '1') {
      // Assumed text: no capture shows a failing restore.
      return void process.stderr.write(`Error: Error: Could not restore snapshot '${snapshot.name}'\n`);
    }
    restoreGraphState(snapshot.state);
    dirty = true;
    return void out(`Restored snapshot [#${index}] '${snapshot.name}'\n`);
  }
  if (command === 'device organize') {
    // Fact 62, raw/v2b-snapshots.txt l.261-286. The layout is not modelled.
    dirty = true;
    return void out('Devices organized by processing order.\n');
  }
  if (command === 'group list' || command.startsWith('group list ')) {
    if (blank) return void out('No groups in the current project.\n');
    // Fact 63, raw/v2b-groups.txt l.16-32: a filter keeps the unfiltered total in the header.
    // Assumed: the filter matches any part of a name, case-sensitive, as the fake's device list filter does. Only a
    // prefix match was captured (`Export`, l.25-28).
    const filter = command.slice('group list'.length).trim();
    const rows = SAMPLE_GROUPS.flatMap((group, index) =>
      group.name.includes(filter)
        ? [`  [#${index}] ${group.name.padEnd(24)} (${group.count} devices)\n`]
        : [],
    );
    const header = `Groups (${SAMPLE_GROUPS.length} total):\n`;
    return void out(rows.length === 0 ? `${header}  (no matches)\n` : `${header}${rows.join('')}\n`);
  }
  const groupCommand = /^group (enable|disable|build) (.+)$/.exec(command);
  if (groupCommand) {
    const [, verb, ref] = groupCommand;
    const index = groupIndex(ref);
    if (index === undefined) return;
    const group = SAMPLE_GROUPS[index];
    // Fact 65, raw/v2b-groups.txt l.257-258. Assumed: `group build` answers an empty group the same way.
    if (group.count === 0) return void out(`Group '${group.name}' contains no devices.\n`);
    // Fact 66: the events of a full build in the command's own frame, then its own late line.
    if (verb === 'build') return void startFull(group);
    // Fact 64: every member's own state is set, and the change is an unsaved one.
    for (const id of group.members) {
      if (verb === 'disable') sampleDisabled.add(id);
      else sampleDisabled.delete(id);
    }
    dirty = true;
    const verbed = verb === 'enable' ? 'Enabled' : 'Disabled';
    return void out(`${verbed} ${group.count} device(s) in group '${group.name}'\n`);
  }
  process.stderr.write(`Error: Unknown command: '${command}'. Type 'help' for a list of commands.\n`);
}
