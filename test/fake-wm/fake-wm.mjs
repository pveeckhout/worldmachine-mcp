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
if (startup === 'ok' && env.FAKE_WM_UNLICENSED !== '1')
  log('Info', 'Startup: Completed. Transferring control into event loop.');

let hung = false;
let dirty = env.FAKE_WM_DIRTY_AT_START === '1';
// FAKE_WM_STARTUP_UNSAVED=1: the start-up project counts as unsaved until the first project switch, so `project open`
// without `force` is refused. Source: capture default-updated (wm-4067), where the freshly started World Machine
// carried state from the previous session and refused an unforced open.
let startupUnsaved = env.FAKE_WM_STARTUP_UNSAVED === '1';
// undefined, SAMPLE_EROSION, or a device from `added`.
let selected;
// 'sample' is the 17-device startup project; 'empty' follows a blank project, a close, or a failed open.
let project = 'sample';
// Devices added with `device add`, listed after the project's own devices.
let added = [];
// First new id: #1 in a blank project (raw/p2b-graph-edits.txt); #536 in the sample project, whose highest id is
// #373 (spec fact 30: three adds gave #536, #537, #538).
// Assumed: ids after those continue by one; `project open` of any file (which the fake answers with the sample
// project) also starts again at #536. Neither is captured.
const firstFreeId = (next) => (next === 'sample' ? 536 : 1);
let nextId = firstFreeId(project);
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
const startGuiBuild = (mode) => {
  guiBuildStarted = true;
  previewUntil = 0;
  event('Prohibiting system sleep');
  if (mode === 'full') event('*** Build Starting ***');
  build = { mode, timer: setTimeout(endBuild, BUILD_MS) };
};
const endBuild = () => {
  const ending = build;
  if (ending === undefined) return;
  clearTimeout(ending.timer);
  build = undefined;
  if (ending.mode === 'full') {
    // Fact 43, raw/v2-build-isolate.txt l.61-68.
    event('*** Build Ended ***');
    trailer();
    later(() => {
      built = true;
      out('Build started.\n');
    });
  } else {
    // Fact 48, raw/v2-build-isolate.txt l.84-85.
    event('System allowed to sleep again');
    const confirmations = tiledConfirmationsOwed + 1;
    tiledConfirmationsOwed = 0;
    later(() => out('Tiled build started.\n'.repeat(confirmations)));
  }
};
const switchTo = (next) => {
  project = next;
  selected = undefined;
  dirty = false;
  startupUnsaved = false;
  added = [];
  nextId = firstFreeId(next);
  built = false;
  savedPath = undefined;
};
// Spec fact 30: the name is the type, without de-duplication (two `device add Gradient` give two devices named
// 'Gradient'; `device add Erosion` gives 'Erosion', raw/p2b-kind-markers.txt). Captured exception,
// raw/v6b-param-set.txt l.13-14: `device add File Output` names the device 'Height Output'.
const DEFAULT_NAMES = { 'File Output': 'Height Output' };
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
let quitting = false;
let partial = '';
let pending = [];
const work = [];
let draining = false;

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
    startGuiBuild(env.FAKE_WM_GUI_BUILD === 'tiled' ? 'tiled' : 'full');
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
      out(`Opened: ${savedPath}\n`);
    }
    return;
  }
  if (command.startsWith('project new default') || command.startsWith('project new blank')) {
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
    out(`Project saved to: ${target}\n`);
    return;
  }
  if (command === 'project undo' || command === 'project redo') {
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
    dirty = true;
    out(`Set ${target} = ${value.replace(/^"(.*)"$/, '$1')}\n`);
    return;
  }
  if (command.startsWith('device add ')) {
    // World Machine rejects an unknown type (raw/p2c-edits.txt l.17-18, spec fact 32). The fake has no list of
    // types, so it accepts every type; tests that need the rejection use a scripted session.
    const type = command.slice('device add '.length);
    const name = DEFAULT_NAMES[type] ?? type;
    // Assumed: the type `device info` and `device list` show for `File Output` is 'Height Output', as the
    // `param list` header of raw/v6b-param-set.txt l.39 shows; no capture shows its `device info`.
    const device = { id: nextId++, name, type: name, enabled: true };
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
  for (const [prefix, file] of [
    ['param list ', 'param-list-erosion.txt'],
    ['wire list ', 'wire-list-erosion.txt'],
  ]) {
    if (command.startsWith(prefix)) {
      const ref = command.slice(prefix.length);
      if (!isErosion(ref)) return void notFound(ref);
      out(fixture(file));
      return;
    }
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
  if (command === 'build start') {
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
      });
    }
    build = { mode: 'full', timer: setTimeout(endBuild, BUILD_MS) };
    return;
  }
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
      later(() => out('Build started.\n'));
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
    if (id === '1') return void out(`#1.exportAlways = ${env.FAKE_WM_EXPORT_ALWAYS === '1'}\n`);
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
  if (command === 'group list')
    return void out(blank ? 'No groups in the current project.\n' : fixture('group-list.txt'));
  process.stderr.write(`Error: Unknown command: '${command}'. Type 'help' for a list of commands.\n`);
}
