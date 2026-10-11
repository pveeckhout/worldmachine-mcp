#!/usr/bin/env node
// Records raw World Machine CLI transcripts for parser fixtures and for spec items V1-V8.
// Needs a licensed local World Machine. Usage: WORLD_MACHINE_BIN=/path/to/wm npm run capture-fixtures
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';

const bin = process.env.WORLD_MACHINE_BIN;
if (!bin) {
  console.error('Set WORLD_MACHINE_BIN to the World Machine executable.');
  process.exit(2);
}

const work = mkdtempSync(join(tmpdir(), 'wm-capture-'));
const spaced = join(work, 'dir with space');
mkdirSync(spaced);

const READY = 'Startup: Completed. Transferring control into event loop.';
const LICENCE = /licen[cs]e/i;
const DEVICE_ROW = /^\s*#(\d+)\s+(.*?)(?:\s{2,}\(([^()]+)\))?\s*$/;
const PARAM_ROW = /^\s{2}(\S+)\s+(\S+)(?:\s+(.*?))?\s*$/;

const child = spawn('/bin/sh', ['-c', 'exec "$0" --cli 2>&1', bin], { stdio: ['pipe', 'pipe', 'ignore'] });
const received = [];
let waiter;
let failure;

const failWaiter = (error) => {
  failure ??= error;
  const current = waiter;
  waiter = undefined;
  current?.reject(error);
};
child.on('error', (error) => failWaiter(error));
child.on('exit', (code, signal) =>
  failWaiter(new Error(`World Machine exited (code ${code}, signal ${signal})`)),
);
child.stdin.on('error', () => {});

createInterface({ input: child.stdout }).on('line', (line) => {
  received.push(line);
  if (waiter?.match(line)) {
    const current = waiter;
    waiter = undefined;
    current.resolve();
  }
});

function waitFor(match, ms, what) {
  if (failure) return Promise.reject(failure);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${what}`)), ms);
    waiter = {
      match,
      resolve: () => {
        clearTimeout(timer);
        resolve();
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    };
  });
}

function scrub(line) {
  return line
    .replaceAll(work, '<WORK>')
    .replaceAll(process.cwd(), '<REPO>')
    .replaceAll(homedir(), '<HOME>')
    .replace(/\/tmp\/\.mount_[^/\s]+/g, '<APPDIR>');
}

// Index of the first received line no section holds yet. run(), wait(), and waitForLine() start from it and move it
// past what they recorded, so a line World Machine prints on its own between two batches is neither dropped nor
// attributed to the next batch's first command (backlog item 86).
let consumed = 0;

async function run(commands, ms = 60_000) {
  const from = consumed;
  const id = Math.random().toString(16).slice(2, 10);
  // A leading marker: World Machine answers it with its unknown-command error, so every line before that answer was
  // printed between batches, not by this batch's first command.
  const marker = `Error: Unknown command: '__start_${id}'`;
  const echo = (i) => `Error: Unknown command: '__end_${id}_${i}'`;
  child.stdin.write(
    `__start_${id}\n${commands.map((command, i) => `${command}\n__end_${id}_${i}\n`).join('')}`,
  );
  // World Machine reads only the first new line per stdin read; empty lines flush the rest (spec facts 14-15).
  const nudge = setInterval(() => child.stdin.write('\n'), 100);
  try {
    await waitFor((line) => line.startsWith(echo(commands.length - 1)), ms, `batch ${id}`);
  } finally {
    clearInterval(nudge);
  }
  const sections = commands.map((command) => ({ command, lines: [] }));
  const unsolicited = [];
  // -1 until the marker's answer; then the index of the command whose output the line belongs to.
  let index = -1;
  for (let at = from; at < received.length; at++) {
    const line = received[at];
    if (index === -1) {
      if (line.startsWith(marker)) index = 0;
      else if (!LICENCE.test(line)) unsolicited.push(scrub(line));
      continue;
    }
    if (line.startsWith(echo(index))) {
      index++;
      if (index === commands.length) {
        consumed = at + 1;
        break;
      }
      continue;
    }
    if (!LICENCE.test(line)) sections[index].lines.push(scrub(line));
  }
  if (unsolicited.length > 0) sections[0].unsolicited = unsolicited;
  return sections;
}

// Records what World Machine prints on its own while no command is pending (build progress), which run() would drop.
async function wait(ms) {
  const start = consumed;
  await new Promise((resolve) => setTimeout(resolve, ms));
  consumed = received.length;
  const lines = received.slice(start, consumed).filter((line) => !LICENCE.test(line));
  return { command: `(waited ${ms} ms)`, lines: lines.map(scrub) };
}

const BUILD_SETTLED = /idle|complete|finished|done|cancel|stopped|not (running|building)|no build/i;

// Polls `build status` once a second until it reads as settled, or is unchanged five times running, or 120 s pass.
async function pollBuild(sections) {
  let previous;
  let unchanged = 0;
  for (let i = 0; i < 120; i++) {
    sections.push(await wait(1000));
    const [status] = await run(['build status']);
    sections.push(status);
    const text = status.lines.join('\n');
    unchanged = text === previous ? unchanged + 1 : 0;
    previous = text;
    if (BUILD_SETTLED.test(text) || unchanged >= 5) return;
  }
  sections.push({ command: '(poll limit reached)', lines: [] });
}

const OUTPUT_FILE = /\.(png|tif|tiff|exr|r16|r32|raw|bmp|tga|jpe?g|hf2|ter|asc|obj|fbx)$/i;

// Output files modified since `since`, up to `depth` levels below `root`; skips caches, git, and node_modules.
function newFiles(root, depth, since) {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (depth === 0 || ['.cache', '.git', 'node_modules'].includes(entry.name)) return [];
      return newFiles(path, depth - 1, since);
    }
    if (!entry.isFile() || !OUTPUT_FILE.test(entry.name)) return [];
    try {
      return statSync(path).mtimeMs >= since ? [path] : [];
    } catch {
      return [];
    }
  });
}

function render(sections) {
  const block = (command, lines) => [`>>> ${scrub(command)}`, ...lines, '<<<'].join('\n');
  return `${sections
    .flatMap(({ command, lines, unsolicited }) => [
      ...(unsolicited ? [block('(printed between batches)', unsolicited)] : []),
      block(command, lines),
    ])
    .join('\n')}\n`;
}

function devices(lines) {
  return lines.flatMap((line) => {
    const match = DEVICE_ROW.exec(line);
    return match ? [{ id: Number(match[1]), name: match[2] }] : [];
  });
}

function newest(lines) {
  return devices(lines).reduce((best, device) => (best && best.id > device.id ? best : device), undefined);
}

function params(lines) {
  return lines.flatMap((line) => {
    const match = PARAM_ROW.exec(line);
    return match ? [{ name: match[1], type: match[2] }] : [];
  });
}

async function freshDevice(sections, type) {
  const added = await run([`device add ${type}`, 'device list']);
  sections.push(...added);
  return newest(added[1].lines);
}

const scenarios = [
  ['system-info', () => run(['system info'])],
  ['device-list-sample', () => run(['device list', 'device list Height'])],
  [
    'v5-read-formats',
    () =>
      run([
        'device select Erosion',
        'device info',
        'param list Erosion',
        'wire list Erosion',
        'param list Height Output',
        'scene show',
        'scene list',
        'group list',
      ]),
  ],
  ['v3-project-new-default', () => run(['project new default force', 'device list', 'scene show'])],
  // V1: one command's result must precede the next command's error line.
  ['v1-result-before-next-error', () => run(['system info', 'capture_bogus_command'])],
  // V2: commands after a failing command in the same batch still run.
  ['v2-batch-after-error', () => run(['capture_bogus_command', 'system info'])],
  [
    'v4-quoting',
    async () => {
      const sections = await run(['project new blank force']);
      for (const target of ['Grad A', '"Grad B"', "'Grad C'"]) {
        const device = await freshDevice(sections, 'Gradient');
        sections.push(...(await run([`device rename ${device.name} ${target}`, 'device list'])));
      }
      const byId = await freshDevice(sections, 'Gradient');
      sections.push(...(await run([`device rename #${byId.id} GradById`, 'device list'])));
      const combiner = await freshDevice(sections, 'Combiner');
      const source = await freshDevice(sections, 'Gradient');
      sections.push(
        ...(await run([
          `wire list ${combiner.name}`,
          `wire connect ${source.name} ${combiner.name}`,
          `wire list ${combiner.name}`,
          `wire connect #${byId.id} #${combiner.id}`,
          `wire list ${combiner.name}`,
          `wire connect Grad A ${combiner.name}`,
          `wire connect "Grad B" ${combiner.name}`,
          `wire list ${combiner.name}`,
        ])),
      );
      return sections;
    },
  ],
  [
    'v6-param-values',
    async () => {
      const sections = await run(['project new blank force']);
      const gradient = await freshDevice(sections, 'Gradient');
      const output = (await freshDevice(sections, 'File Output')).name;
      const listed = await run([`param list ${gradient.name}`, `param list ${output}`]);
      sections.push(...listed);
      const gradientParams = params(listed[0].lines);
      const numeric = gradientParams.find((p) =>
        /^(float|double|int|integer|number|scalar|distance|angle)$/i.test(p.type),
      );
      const commands = [];
      if (numeric) {
        const ref = `${gradient.name}.${numeric.name}`;
        commands.push(
          `param get ${ref}`,
          `param set ${ref} 0.5`,
          `param get ${ref}`,
          `param set ${ref} 2`,
          `param get ${ref}`,
        );
      }
      commands.push(
        `param get ${output}.exportAlways`,
        `param set ${output}.exportAlways true`,
        `param get ${output}.exportAlways`,
        `param set ${output}.exportAlways 0`,
        `param get ${output}.exportAlways`,
        `param set ${output}.filename ${join(work, 'out.png')}`,
        `param get ${output}.filename`,
        `param set ${output}.format PNG (16bit)`,
        `param get ${output}.format`,
        `param list ${output}`,
      );
      sections.push(...(await run(commands)));
      return sections;
    },
  ],
  [
    'v7-project-ops',
    () =>
      run([
        `project save ${join(work, 'capture.tmd')}`,
        'project undo',
        'project redo',
        `project save ${join(spaced, 'capture.tmd')}`,
        `project open ${join(work, 'capture.tmd')}`,
        `project open ${join(spaced, 'capture.tmd')} force`,
        `project open ${join(work, 'missing.tmd')} force`,
        'device list',
      ]),
  ],
  ['help', () => run(['help', 'help param', 'help device', 'help wire', 'help scene', 'help project'])],
  [
    'p2a-edge-cases',
    async () => {
      const sections = await run([
        'project new blank force',
        'group list',
        'scene show',
        'scene list',
        'device info',
        'device select capture_missing_device',
        'project undo',
        'project redo',
        'device add Gradient',
        'wire list Gradient',
        'device select Gradient',
        'device info',
        'device select #1',
        'param list #1',
        'wire list #1',
        'project undo',
        'device list',
        'project redo',
        'device list',
        `project save ${join(work, 'no-such-dir', 'x.tmd')}`,
        `project save ${join(work, 'edge.tmd')}`,
        'project close force',
        'device list',
        'project close force',
        'scene show',
        'group list',
        `project open ${join(work, 'edge.tmd')} force`,
      ]);
      return sections;
    },
  ],
  [
    'v6b-param-set',
    async () => {
      const sections = await run(['project new blank force']);
      const gradient = await freshDevice(sections, 'Gradient');
      const output = await freshDevice(sections, 'File Output');
      const combiner = await freshDevice(sections, 'Combiner');
      const listed = await run([
        `param list ${gradient.name}`,
        `param list ${output.name}`,
        `param list ${combiner.name}`,
      ]);
      sections.push(...listed);
      const all = [
        ...params(listed[0].lines).map((p) => ({ ...p, device: gradient })),
        ...params(listed[1].lines).map((p) => ({ ...p, device: output })),
        ...params(listed[2].lines).map((p) => ({ ...p, device: combiner })),
      ];
      // References to a device whose name contains a space, against one bool parameter.
      const ref = output.name;
      sections.push(
        ...(await run([
          `param set "${ref}".exportAlways true`,
          `param get ${ref}.exportAlways`,
          `param set "${ref}.exportAlways" false`,
          `param get ${ref}.exportAlways`,
          `param set #${output.id}.exportAlways true`,
          `param get ${ref}.exportAlways`,
          `device select ${ref}`,
          'param set exportAlways false',
          `param get ${ref}.exportAlways`,
        ])),
      );
      // Value syntax per type, on devices without spaces where possible, referenced by #id.
      const commands = [];
      for (const type of ['float', 'int', 'bool', 'enum']) {
        const p =
          all.find((candidate) => candidate.type === type && candidate.device.id !== output.id) ??
          all.find((candidate) => candidate.type === type);
        if (!p) continue;
        const target = `#${p.device.id}.${p.name}`;
        const values = {
          float: ['0.5', '2', '1.5 km', '1,5'],
          int: ['3', '3.0'],
          bool: ['true', 'false', '1', '0', 'yes', 'off'],
          enum: ['0', '1', 'invalid-enum-value'],
        }[type];
        commands.push(`param get ${target}`);
        for (const value of values) commands.push(`param set ${target} ${value}`, `param get ${target}`);
      }
      const filename = all.find((candidate) => candidate.type === 'filename');
      if (filename) {
        const target = `#${filename.device.id}.${filename.name}`;
        commands.push(
          `param set ${target} ${join(work, 'out.png')}`,
          `param get ${target}`,
          `param set ${target} ${join(spaced, 'out file.png')}`,
          `param get ${target}`,
          `param set ${target} "${join(spaced, 'quoted file.png')}"`,
          `param get ${target}`,
        );
      }
      sections.push(...(await run(commands)));
      return sections;
    },
  ],
  [
    // Plan 2b: outputs of the graph-edit and scene setters, their error shapes, and how state reads back.
    'p2b-graph-edits',
    async () => {
      const sections = await run(['project new blank force']);
      const source = await freshDevice(sections, 'Gradient');
      const target = await freshDevice(sections, 'Combiner');
      const s = `#${source.id}`;
      const t = `#${target.id}`;
      sections.push(
        ...(await run([
          `wire connect ${s} ${t}`,
          `wire list ${t}`,
          `device disable ${s}`,
          `device select ${s}`,
          'device info',
          'device list',
          `device disable ${s}`,
          `device enable ${s}`,
          `device select ${s}`,
          'device info',
          `device enable ${s}`,
          `device bypass ${s}`,
          `device select ${s}`,
          'device info',
          'device list',
          `device bypass ${s}`,
          `device select ${s}`,
          'device info',
          'device enable capture_missing_device',
          'device disable capture_missing_device',
          'device bypass capture_missing_device',
          `wire disconnect ${s} ${t}`,
          `wire list ${t}`,
          `wire disconnect ${s} ${t}`,
          `wire connect ${s} ${t}`,
          `wire disconnect ${s}.1 ${t}.1`,
          `wire list ${t}`,
          `wire disconnect capture_missing_device ${t}`,
          `device delete ${s}`,
          'device list',
          `wire list ${t}`,
          'project undo',
          'device list',
          `wire list ${t}`,
          'device delete capture_missing_device',
          'scene name',
          'scene name Capture Scene',
          'scene name',
          'scene origin 1.5 -2',
          'scene origin abc 1',
          'scene size',
          'scene size 8 4',
          'scene size 0 0',
          'scene size abc 1',
          'scene resolution',
          'scene resolution 1025',
          'scene resolution up',
          'scene resolution down 2',
          'scene resolution abc',
          'scene show',
          'project undo',
          'scene show',
          // End on a closed project so the quit shows no discard dialog (spec fact 19).
          'project close force',
        ])),
      );
      return sections;
    },
  ],
  [
    // Plan 2b: where `device list` puts state markers on a row that also has a (kind) suffix, and in which order
    // two markers appear (a: disable then bypass; b: bypass then disable).
    'p2b-kind-markers',
    async () => {
      // The sample project is the startup project (spec fact 8); `project new default` recreates it (V3).
      const sections = await run(['project new default force', 'device list']);
      const kinded = sections[1].lines.flatMap((line) => {
        const match = DEVICE_ROW.exec(line);
        return match?.[3] === undefined ? [] : [{ id: Number(match[1]), name: match[2], kind: match[3] }];
      });
      const first = kinded[0];
      const last = kinded.at(-1);
      if (!first || !last || first.id === last.id) {
        throw new Error('p2b-kind-markers needs two devices with a (kind) suffix in the default project');
      }
      const a = `#${first.id}`;
      const b = `#${last.id}`;
      sections.push(
        ...(await run([
          `device disable ${a}`,
          'device list',
          `device bypass ${a}`,
          'device list',
          `device bypass ${b}`,
          `device disable ${b}`,
          'device list',
          // Plan 2b fake fidelity: duplicate names and the next id, another type's default name, name case.
          'device add Gradient',
          'device add Gradient',
          'device add Erosion',
          'device list Gradient',
          'device list Erosion',
          'device select gradient',
          // Disable and bypass modify the project; close it so the quit shows no discard dialog (spec fact 19).
          'project close force',
        ])),
      );
      return sections;
    },
  ],
  [
    // Plan 2c: edit behaviour that no earlier capture showed.
    // Ends on a closed project so the quit shows no discard dialog (spec fact 19).
    'p2c-edits',
    () =>
      run([
        'project new blank force',
        'device add Gradient',
        'device add Combiner',
        'device add File Output',
        'device add Gradient',
        'device add NoSuchDeviceType',
        'device list',
        'device rename #4 Grad A B',
        'device list',
        'device rename #4 ABCDEFGHIJKLMNOPQRSTUVW',
        'device list',
        'device rename #4 ABCDEFGHIJKLMNOPQRSTUVWX',
        'device list',
        'device rename #4 ABCDEFGHIJKLMNOPQRSTUVWXYZ0123',
        'device list',
        'device rename #4 Gradient',
        'device list',
        'device rename #4 Grad A',
        'wire connect #4 #2',
        'wire list #2',
        'wire list #4',
        'wire connect #4 #2',
        'wire connect #1.1 #2.2',
        'wire list #2',
        'wire disconnect #1.1 #2.2',
        'wire connect #1.3 #2.2',
        'wire connect #1 #2.9',
        'wire list #2',
        'wire connect #2 #2',
        'wire list #2',
        'device delete #4',
        'wire list #2',
        'project undo',
        'device list',
        'wire list #2',
        'param set #1.Direction -1',
        'param get #1.Direction',
        'param set #1.Width -0.5',
        'param get #1.Width',
        'param set #1.Width 1e-1',
        'param get #1.Width',
        'param set #1.Width .5',
        'param get #1.Width',
        'param set #1.Tiling Mirrored Repeat',
        'param get #1.Tiling',
        'param set #1.Tiling clamp',
        'param get #1.Tiling',
        'param set #1.Tiling 99',
        'param get #1.Tiling',
        'param set #3.exportAlways no',
        'param get #3.exportAlways',
        'param set #3.exportAlways on',
        'param get #3.exportAlways',
        'param set #3.exportAlways TRUE',
        'param get #3.exportAlways',
        'param set #1.width 1',
        'param get #1.Width',
        'param get #1.width',
        'param set #3.writeButton 1',
        'param list #3',
        'param get #1.Direction',
        'param set #1.Direction 5',
        'param set #1.Width 1',
        'project undo',
        'param get #1.Direction',
        'param get #1.Width',
        'project undo',
        'param get #1.Direction',
        'param get #1.Width',
        'scene lock on',
        'scene name Locked Name',
        'scene origin 1 1',
        'scene size 4 4',
        'scene resolution 512',
        'scene show',
        'scene lock off',
        'scene resolution 7',
        'scene resolution 100000',
        'scene show',
        'project new default force',
        'param set #35.groupBasic 1',
        'param get #35.groupBasic',
        'project close force',
      ]),
  ],
  [
    // Backlog follow-ups after Plan 2c: undo steps for add-then-rename, and default names of longer device types.
    // Candidate type names are guesses; an unknown one prints `Device type not found` (fact 32). Ends closed (fact 19).
    'p2c-undo-names',
    () =>
      run([
        'project new blank force',
        'device add Gradient',
        'device rename #1 Grad A',
        'device list',
        'project undo',
        'device list',
        'project undo',
        'device list',
        'project redo',
        'device list',
        'project redo',
        'device list',
        'device add Thermal Weathering',
        'device add Coastal Erosion',
        'device add Snowfall Simulation',
        'device add Advanced Perlin',
        'device add Curvature Selector',
        'device add Convexity Selector',
        'device add Distance Function',
        'device add Layout Generator',
        'device add Terrain Library',
        'device add Splat Converter',
        'device add Hydrology Simulation',
        'device add Advanced Thermal Weathering',
        'device add Erosion (Legacy)',
        'device add Height Selector',
        'device list',
        'project close force',
      ]),
  ],
  [
    // What the console can set beyond scene and device parameters: the help of the groups not yet captured.
    'help-more',
    () => run(['help build', 'help export', 'help debug', 'help snapshot', 'help system', 'help group']),
  ],
  [
    // v2: preview, full, cancelled, and tiled builds; whether the console answers during a build; where `export all`
    // writes with the default filename template. Low resolution keeps the builds short. Ends closed (fact 19).
    'v2-build-export',
    async () => {
      const since = Date.now();
      const sections = [];
      // A batch that times out (the console busy during a build) keeps what was captured up to that point.
      try {
        await buildAndExport(sections, since);
      } catch (error) {
        sections.push({ command: '(scenario stopped)', lines: [scrub(error.message)] });
      }
      return sections;
    },
  ],
  [
    // v2 follow-up: whether a long build holds the console, whether `build stop` reaches a running build, what a tiled
    // build and an export after an edit write, and where `export all` writes for an unsaved project. Ends closed.
    'v2-build-long',
    async () => {
      const sections = [];
      try {
        await longBuilds(sections);
      } catch (error) {
        sections.push({ command: '(scenario stopped)', lines: [scrub(error.message)] });
      }
      return sections;
    },
  ],
  [
    // v2 follow-up after the SIGSEGV in v2-build-long: one command per batch so a crash names its command; which
    // outputs a plain and a tiled build write; where `export all` writes for an unsaved project. Ends closed.
    'v2-build-isolate',
    async () => {
      const sections = [];
      try {
        await isolatedBuilds(sections);
      } catch (error) {
        sections.push({ command: '(scenario stopped)', lines: [scrub(error.message)] });
      }
      return sections;
    },
  ],
  [
    // v2 design checks: Build Event lines inside another command's batch during a long build, a second `build start`
    // while one runs, and a 1025 tiled build stopped and run to its end. Ends closed (fact 19).
    'v2-build-concurrency',
    async () => {
      const sections = [];
      try {
        await concurrentBuilds(sections);
      } catch (error) {
        sections.push({ command: '(scenario stopped)', lines: [scrub(error.message)] });
      }
      return sections;
    },
  ],
  [
    // v2a live finding: when a full build's results become exportable. `export all` right after `Build Ended`, after
    // the late `Build started.`, and after a fixed wait. Ends closed (fact 19).
    'v2-build-export-timing',
    async () => {
      const sections = [];
      try {
        await exportTiming(sections);
      } catch (error) {
        sections.push({ command: '(scenario stopped)', lines: [scrub(error.message)] });
      }
      return sections;
    },
  ],
  [
    // The default project after World Machine updated it to the current build, saved by the user as
    // updated_Project.tmd in the repository root (override with WM_UPDATED_PROJECT). Every device's info,
    // parameters, and wires, plus scenes, groups, and exports. Opened with force, because a just-started World
    // Machine reports unsaved changes and refuses a plain project open; ends closed without saving.
    'default-updated',
    async () => {
      const file = process.env.WM_UPDATED_PROJECT ?? join(process.cwd(), 'updated_Project.tmd');
      const sections = await run([`project open ${file} force`, 'device list'], 120_000);
      const ids = devices(sections[1].lines).map((device) => device.id);
      sections.push(
        ...(await run(
          ids.flatMap((id) => [
            `device select #${id}`,
            'device info',
            `param list #${id}`,
            `wire list #${id}`,
          ]),
          300_000,
        )),
      );
      sections.push(
        ...(await run(['scene list', 'scene show', 'group list', 'export list', 'project close force'])),
      );
      return sections;
    },
  ],
  [
    // v2b: snapshot create, list, restore, and delete (names, duplicates, indexes, missing ones), whether a snapshot,
    // a restore, or `device organize` counts as an unsaved change, whether undo reverts them, and whether snapshots
    // persist in the saved .tmd. Default project at 257 in <WORK>. Ends closed (fact 19).
    'v2b-snapshots',
    async () => {
      const sections = [];
      try {
        await snapshots(sections);
      } catch (error) {
        sections.push({ command: '(scenario stopped)', lines: [scrub(error.message)] });
      }
      return sections;
    },
  ],
  [
    // v2b follow-up: what `snapshot restore` does to the graph, to later snapshots, to the unsaved state, and to
    // undo. Default project at 257 in <WORK>. Ends closed (fact 19).
    'v2b-snapshot-restore',
    async () => {
      const sections = [];
      try {
        await snapshotRestore(sections);
      } catch (error) {
        sections.push({ command: '(scenario stopped)', lines: [scrub(error.message)] });
      }
      return sections;
    },
  ],
  [
    // v2b groups: list and filter, enable and disable by name and #index, what that does to each member device's
    // own state, unsaved state, undo, missing and empty groups, and what `group build` prints and writes.
    // Default project at 257 in <WORK>. Ends closed (fact 19).
    'v2b-groups',
    async () => {
      const sections = [];
      try {
        await groups(sections);
      } catch (error) {
        sections.push({ command: '(scenario stopped)', lines: [scrub(error.message)] });
      }
      return sections;
    },
  ],
  [
    // v2b assumptions that the console can settle: B1 (snapshot names over 40 characters), B3 (a restore brings back
    // the scene), B5 (exportAlways during a group build), B6 (a stopped group build prints its late line), and B8 for
    // snapshots (12 rows). Default project in <WORK>. Ends closed (fact 19).
    'v2b-assumptions',
    async () => {
      const sections = [];
      try {
        await v2bAssumptions(sections);
      } catch (error) {
        sections.push({ command: '(scenario stopped)', lines: [scrub(error.message)] });
      }
      return sections;
    },
  ],
  [
    // v3 assumptions C1 (a snapshot restore reverts parameter values, wires, a deleted device with its id, and enabled
    // state) and C2 (the `Type:` line of `device info` is the type string `device add` takes). Default project at 257
    // in <WORK>. Ends closed (fact 19).
    'v3-assumptions',
    async () => {
      const sections = [];
      try {
        await v3Assumptions(sections);
      } catch (error) {
        sections.push({ command: '(scenario stopped)', lines: [scrub(error.message)] });
      }
      return sections;
    },
  ],
  [
    // apply_graph bypass rollback: does `snapshot restore` revert a device's bypass (fact 78 shows parameters, wires,
    // enabled state, and devices, not bypass)? Saved default project, a snapshot, `device bypass`, restore, read back.
    // Ends closed.
    'bypass-restore',
    async () => {
      const sections = [];
      try {
        const file = join(work, 'bypass-restore.tmd');
        const listed = await run([
          'project new default force',
          'scene resolution 257',
          `project save ${file}`,
          'device list',
        ]);
        sections.push(...listed);
        await pollBuild(sections);
        const target = devices(listed[3].lines)[1];
        if (target === undefined) throw new Error('the default project lists fewer than two devices');
        sections.push(
          ...(await run([
            'snapshot create B',
            `device bypass #${target.id}`,
            `device select #${target.id}`,
            'device info',
            'device list',
            'snapshot restore B',
            `device select #${target.id}`,
            'device info',
            'device list',
            'project close force',
          ])),
        );
      } catch (error) {
        sections.push({ command: '(scenario stopped)', lines: [scrub(error.message)] });
      }
      return sections;
    },
  ],
  [
    // set_device_bypassed assumption: does World Machine count a bypass toggle as an unsaved change? A saved default
    // project, one `device bypass`, then an unforced `project new default`, which an unsaved project refuses
    // (raw/v2b-snapshots.txt l.285-286). Then the same after toggling back and saving again. Ends closed.
    'bypass-unsaved',
    async () => {
      const sections = [];
      try {
        const file = join(work, 'bypass-unsaved.tmd');
        const listed = await run([
          'project new default force',
          'scene resolution 257',
          `project save ${file}`,
          'device list',
        ]);
        sections.push(...listed);
        await pollBuild(sections);
        const target = devices(listed[3].lines)[1];
        if (target === undefined) throw new Error('the default project lists fewer than two devices');
        sections.push(
          ...(await run([
            `device bypass #${target.id}`,
            'project new default',
            `device bypass #${target.id}`,
            `project save ${file}`,
            'project new default',
            'project close force',
          ])),
        );
      } catch (error) {
        sections.push({ command: '(scenario stopped)', lines: [scrub(error.message)] });
      }
      return sections;
    },
  ],
  [
    // Backlog: how long a tiled build keeps writing tile files after its end line, for a build that finishes and one
    // stopped about 8 s in. The user sets the tiled layout in the window (operator trigger 'tiles' in
    // WM_CAPTURE_TRIGGERS); every 250 ms the capture stamps each new Build Event line and each tile file's mtime
    // relative to `build start tiled`. Default project at 1025 in <WORK>. A real `build stop` may keep World Machine from
    // quitting (fact 75).
    'tiled-stop-timing',
    async () => {
      const sections = [];
      try {
        await tiledStopTiming(sections);
      } catch (error) {
        sections.push({ command: '(scenario stopped)', lines: [scrub(error.message)] });
      }
      return sections;
    },
  ],
  [
    // v2a A2 and A4, v2b B2, B4, B7, B8, interactive (operator creates the trigger files in WM_CAPTURE_TRIGGERS when
    // the user reports each window step done). A4: a full build whose File Input names a missing file. B4/B7/B8: groups
    // the user creates in the window (a one-device 'Solo', two named 'Twin', 10 or more in all). B2: `device organize`
    // and `project undo` while the user watches the layout. A2: `build stop` during a tiled build with a large layout
    // the user sets in the window. Default project at 1025 in <WORK>. A real `build stop` may keep World Machine from
    // quitting (fact 75).
    'window-assumptions',
    async () => {
      const sections = [];
      try {
        await windowAssumptions(sections);
      } catch (error) {
        sections.push({ command: '(scenario stopped)', lines: [scrub(error.message)] });
      }
      return sections;
    },
  ],
  [
    // v2a A1 and R12, interactive: what World Machine prints for builds started from its window (a full and a tiled
    // build), and the trailer order when a window-started full build is stopped from the console and a console tiled
    // build follows at once. The user starts each window build when the log shows its STEP line; the operator creates
    // the step's trigger file in WM_CAPTURE_TRIGGERS when the user reports it done. Default project in <WORK>. A real
    // `build stop` may keep World Machine from quitting (fact 75).
    'v2a-a1-window-builds',
    async () => {
      const sections = [];
      try {
        await windowBuilds(sections);
      } catch (error) {
        sections.push({ command: '(scenario stopped)', lines: [scrub(error.message)] });
      }
      return sections;
    },
  ],
  [
    // Backlog P11-4: does World Machine read `~`, a backslash, `..` after a backslash, environment variables, a doubled
    // slash, or an absolute path in an output file name template the way the server's expansion does
    // (src/domain/output-template.ts)? Sets File Output #1's filename directly, exports, and records where files land,
    // including the parent of <WORK> and <HOME>. Probe files found outside <WORK> are deleted after they are recorded.
    // Default project at 257 in <WORK>/p11. Ends closed.
    'p11-4-template-paths',
    async () => {
      const sections = [];
      try {
        await p114TemplatePaths(sections);
      } catch (error) {
        sections.push({ command: '(scenario stopped)', lines: [scrub(error.message)] });
      }
      return sections;
    },
  ],
  [
    // Which device types ignore `device rename` (fact 80 found it for Combiner). Candidate type names come from the file
    // named by WM_RENAME_CANDIDATES, one per line; names World Machine rejects are only counted. Default project. Ends
    // closed.
    'v3-rename-types',
    async () => {
      const sections = [];
      try {
        await v3RenameTypes(sections);
      } catch (error) {
        sections.push({ command: '(scenario stopped)', lines: [scrub(error.message)] });
      }
      return sections;
    },
  ],
  [
    // v3 live failure 2026-10-11: `device rename #<id> Mix` on a new Combiner was confirmed, but `device list` still
    // showed 'Combiner'. Separates the device type, the name, and a repeated rename. Default project. Ends closed.
    'v3-rename-probe',
    async () => {
      const sections = [];
      try {
        await v3RenameProbe(sections);
      } catch (error) {
        sections.push({ command: '(scenario stopped)', lines: [scrub(error.message)] });
      }
      return sections;
    },
  ],
  // Diagnostics for the quit crash seen after stopped group builds (World Machine crash reports 2026-10-06 14:46 and
  // 15:13) and for automatic exports. Each ends without closing, so the script's own close and quit end World Machine,
  // as the server does. Run one per World Machine start.
  ['diag-group-quit', () => diagnostic('group')],
  ['diag-group-stop-quit', () => diagnostic('group-stop')],
  ['diag-full-stop-quit', () => diagnostic('full-stop')],
  ['diag-export-twice', () => diagnostic('export-twice')],
  [
    // v2a A3 (export list with a device name over 20 characters) and A4 (what a failing build prints, if a file-input
    // device type exists and fails without a file). Candidate type names are guesses; an unknown one prints `Device type
    // not found` (fact 32). Default project at 257 in <WORK>. Ends closed (fact 19).
    'v2a-a3-a4',
    async () => {
      const sections = [];
      try {
        const file = join(work, 'a3a4.tmd');
        sections.push(
          ...(await run(['project new default force', 'scene resolution 257', `project save ${file}`])),
        );
        await pollBuild(sections);
        sections.push(
          ...(await run([
            'device rename #1 Height Output With A Long Name',
            'device list',
            'export list',
            'device add File Input',
            'device add Height File Input',
            'device add Heightfield Input',
            'device add Import',
            'device add File Input Device',
            'device list',
          ])),
        );
        await pollBuild(sections);
        await timed(sections, ['build start']);
        sections.push(await waitForLine(/Build Ended/, 60_000));
        sections.push(await waitForLine(/^Build started\.$/, 15_000));
        sections.push(...(await run(['build status', 'export all', 'project close force'])));
      } catch (error) {
        sections.push({ command: '(scenario stopped)', lines: [scrub(error.message)] });
      }
      return sections;
    },
  ],
  [
    // v2a A3 follow-up: which name `export all` writes for a device name over 23 characters (the list and the report
    // cut it to 23). Lists the files in <WORK> after the export. Default project at 257. Ends closed (fact 19).
    'v2a-a3-files',
    async () => {
      const sections = [];
      try {
        const file = join(work, 'a3files.tmd');
        sections.push(
          ...(await run(['project new default force', 'scene resolution 257', `project save ${file}`])),
        );
        await pollBuild(sections);
        sections.push(
          ...(await run([
            'device rename #1 Height Output With A Long Name',
            'device select #1',
            'device info',
            'export list',
          ])),
        );
        await pollBuild(sections);
        await timed(sections, ['build start']);
        sections.push(await waitForLine(/^Build started\.$/, 30_000));
        const since = Date.now();
        sections.push(...(await run(['export all'])));
        sections.push(await wait(1500));
        filesSince(sections, since, 'by export all with a long device name');
        sections.push(...(await run(['project close force'])));
      } catch (error) {
        sections.push({ command: '(scenario stopped)', lines: [scrub(error.message)] });
      }
      return sections;
    },
  ],
];

async function buildAndExport(sections, since) {
  sections.push(
    ...(await run([
      'project new default force',
      'scene resolution 257',
      `project save ${join(work, 'build-test.tmd')}`,
      'build status',
      'export list',
      'build preview',
    ])),
  );
  await pollBuild(sections);
  sections.push(...(await run(['build start', 'device list', 'build status'])));
  await pollBuild(sections);
  sections.push(...(await run(['build start', 'build stop', 'build status'])));
  await pollBuild(sections);
  sections.push(...(await run(['export all'])));
  await pollBuild(sections);
  sections.push(await wait(2000));
  const found = [
    ...newFiles(work, 3, since),
    ...newFiles(process.cwd(), 2, since),
    ...newFiles(homedir(), 4, since),
  ];
  sections.push({
    command: '(output files written since the scenario started)',
    lines: [...new Set(found)].map(scrub),
  });
  sections.push(...(await run(['build start tiled'])));
  sections.push(await wait(3000));
  sections.push(...(await run(['build status', 'build stop', 'build status'])));
  await pollBuild(sections);
  sections.push(...(await run(['project close force'])));
}

// Runs a batch and appends how long it took, in whole seconds, so a batch held up by a build shows.
async function timed(sections, commands) {
  const start = Date.now();
  sections.push(...(await run(commands, 600_000)));
  sections.push({ command: `(batch took ${Math.round((Date.now() - start) / 1000)} s)`, lines: [] });
}

function filesSince(sections, since, label) {
  const found = [
    ...newFiles(work, 3, since),
    ...newFiles(process.cwd(), 2, since),
    ...newFiles(homedir(), 4, since),
  ];
  sections.push({ command: `(output files written ${label})`, lines: [...new Set(found)].map(scrub) });
}

async function longBuilds(sections) {
  sections.push(
    ...(await run([
      'project new default force',
      'scene list',
      `project save ${join(work, 'long-test.tmd')}`,
      'build status',
    ])),
  );
  await pollBuild(sections);
  await timed(sections, ['build start']);
  sections.push(await wait(2000));
  await timed(sections, ['build start', 'build stop', 'build status']);
  await pollBuild(sections);
  await timed(sections, ['build preview']);
  sections.push(await wait(1000));
  await timed(sections, ['build status', 'build stop', 'build status']);
  await pollBuild(sections);

  let since = Date.now();
  await timed(sections, ['device disable Thermal Weathering', 'export all']);
  await pollBuild(sections);
  filesSince(sections, since, 'by the export after an edit');

  await timed(sections, ['scene resolution 257', 'param get Height Output.tiled']);
  since = Date.now();
  await timed(sections, ['build start tiled']);
  sections.push(await wait(5000));
  await pollBuild(sections);
  filesSince(sections, since, 'by the tiled build');

  since = Date.now();
  await timed(sections, ['project new default force', 'export list', 'export all']);
  await pollBuild(sections);
  filesSince(sections, since, 'by the export of an unsaved project');
  sections.push(...(await run(['project close force'])));
}

// The default project's outputs: #1 Height Output, #308 Material Output, #309 Colormap only, #318 Splatmap.
const OUTPUT_IDS = ['#1', '#308', '#309', '#318'];

async function isolatedBuilds(sections) {
  for (const command of ['project new default force', 'scene resolution 257'])
    await timed(sections, [command]);
  await timed(sections, [`project save ${join(work, 'iso.tmd')}`]);
  for (const id of OUTPUT_IDS)
    await timed(sections, [`param get ${id}.exportAlways`, `param get ${id}.tiled`]);
  await pollBuild(sections);

  let since = Date.now();
  await timed(sections, ['build start']);
  await pollBuild(sections);
  sections.push(await wait(2000));
  filesSince(sections, since, 'by a plain build');

  since = Date.now();
  await timed(sections, ['build start tiled']);
  await pollBuild(sections);
  sections.push(await wait(3000));
  filesSince(sections, since, 'by a tiled build');

  await timed(sections, ['project new default force']);
  await pollBuild(sections);
  await timed(sections, ['scene resolution 257']);
  await timed(sections, ['build start']);
  await pollBuild(sections);
  await timed(sections, ['export list']);
  since = Date.now();
  await timed(sections, ['export all']);
  sections.push(await wait(2000));
  filesSince(sections, since, 'by the export of an unsaved project');
  await timed(sections, ['project close force']);
}

// Records lines until one matches `pattern` or `ms` pass; the header says which and how long it took.
async function waitForLine(pattern, ms) {
  const start = consumed;
  const began = Date.now();
  const seen = () => received.slice(start).some((line) => pattern.test(line));
  while (Date.now() - began < ms && !seen()) await new Promise((resolve) => setTimeout(resolve, 250));
  const outcome = seen() ? 'seen' : 'not seen';
  consumed = received.length;
  const lines = received.slice(start, consumed).filter((line) => !LICENCE.test(line));
  return {
    command: `(waited for /${pattern.source}/: ${outcome} after ${Math.round((Date.now() - began) / 1000)} s)`,
    lines: lines.map(scrub),
  };
}

async function concurrentBuilds(sections) {
  await timed(sections, ['project new default force']);
  await timed(sections, ['scene resolution 4097']);
  await timed(sections, [`project save ${join(work, 'conc.tmd')}`]);
  await pollBuild(sections);

  await timed(sections, ['build start']);
  await timed(sections, ['device list']);
  await timed(sections, ['build start']);
  await timed(sections, ['build status']);
  await timed(sections, ['device list']);
  sections.push(await waitForLine(/Build Ended/, 300_000));
  await pollBuild(sections);

  await timed(sections, ['scene resolution 1025']);
  await pollBuild(sections);
  let since = Date.now();
  await timed(sections, ['build start tiled']);
  sections.push(await wait(1000));
  await timed(sections, ['build status']);
  await timed(sections, ['build stop']);
  sections.push(await waitForLine(/Tiled build started/, 60_000));
  filesSince(sections, since, 'by the stopped tiled build');

  since = Date.now();
  await timed(sections, ['build start tiled']);
  sections.push(await waitForLine(/Tiled build started/, 300_000));
  sections.push(await wait(2000));
  filesSince(sections, since, 'by the tiled build run to its end');
  await timed(sections, ['project close force']);
}

// True when a section already holds the build's end line (a fast build can end inside its own start frame).
function endedIn(sections) {
  return sections.some((section) => section.lines.some((line) => line.includes('Build Ended')));
}

async function exportTiming(sections) {
  await timed(sections, ['project new default force']);
  await timed(sections, ['scene resolution 257']);
  await timed(sections, [`project save ${join(work, 'timing.tmd')}`]);
  await pollBuild(sections);

  await timed(sections, ['build start']);
  if (!endedIn(sections)) sections.push(await waitForLine(/Build Ended/, 60_000));
  await timed(sections, ['export all']);
  if (!sections.some((s) => s.lines.includes('Build started.')))
    sections.push(await waitForLine(/^Build started\.$/, 30_000));
  await timed(sections, ['export all']);

  const second = sections.length;
  await timed(sections, ['build start']);
  if (!endedIn(sections.slice(second))) sections.push(await waitForLine(/Build Ended/, 60_000));
  sections.push(await wait(3000));
  await timed(sections, ['export all']);
  await timed(sections, ['project close force']);
}

// Lists every file in <WORK> (names only), to see whether snapshots are written next to the project.
function workFiles(sections, label) {
  const names = readdirSync(work, { recursive: true }).map(String).sort();
  sections.push({ command: `(files in <WORK> ${label})`, lines: names });
}

// A plain `project new default` is refused while the project has unsaved changes (v7-project-ops), so it shows
// whether the previous command marked the project as changed. It is followed by reopening the saved project.
async function dirtyProbe(sections, file) {
  sections.push(...(await run(['project new default'])));
  sections.push(...(await run([`project open ${file} force`])));
}

async function snapshots(sections) {
  const file = join(work, 'snap.tmd');
  sections.push(
    ...(await run(['project new default force', 'scene resolution 257', `project save ${file}`])),
  );
  await pollBuild(sections);
  workFiles(sections, 'after the first save');

  sections.push(...(await run(['snapshot list', 'snapshots', 'snapshot create A', 'snapshot list'])));
  workFiles(sections, 'after snapshot create A');
  await dirtyProbe(sections, file);
  sections.push(...(await run(['snapshot list'])));

  sections.push(
    ...(await run([
      'snapshot create A',
      `project save ${file}`,
      'device disable Thermal Weathering',
      'device list',
      'snapshot create B with space',
      'snapshot create A',
      'snapshot create',
      `snapshot create ${'n'.repeat(40)}`,
      'snapshot list',
    ])),
  );

  sections.push(
    ...(await run([
      'snapshot restore A',
      'device list',
      'snapshot list',
      'project undo',
      'device list',
      'snapshot restore #0',
      'device list',
      'snapshot restore missing',
      'snapshot restore #99',
    ])),
  );
  sections.push(...(await run([`project save ${file}`, 'snapshot restore A'])));
  await dirtyProbe(sections, file);

  sections.push(
    ...(await run(['snapshot list', 'project close force', `project open ${file} force`, 'snapshot list'])),
  );

  sections.push(
    ...(await run([
      'snapshot delete B with space',
      'snapshot list',
      'snapshot delete #0',
      'snapshot list',
      'snapshot delete missing',
      'snapshot delete #99',
    ])),
  );

  sections.push(...(await run([`project save ${file}`, 'device organize', 'device list'])));
  await dirtyProbe(sections, file);
  sections.push(...(await run(['device organize', 'project undo', 'device list'])));
  workFiles(sections, 'at the end');
  sections.push(...(await run(['project close force'])));
}

async function snapshotRestore(sections) {
  const file = join(work, 'restore.tmd');
  sections.push(
    ...(await run(['project new default force', 'scene resolution 257', `project save ${file}`])),
  );
  await pollBuild(sections);
  sections.push(
    ...(await run([
      'snapshot create S0',
      `project save ${file}`,
      'device disable Thermal Weathering',
      'device add Gradient',
      'snapshot create S1',
      'device list',
      'snapshot restore #0',
      'device list',
      'snapshot list',
    ])),
  );
  await dirtyProbe(sections, file);
  sections.push(
    ...(await run([
      'device list',
      'snapshot list',
      'device disable Thermal Weathering',
      'snapshot restore #0',
      'device list',
      'project undo',
      'device list',
      'project undo',
      'device list',
      'project redo',
      'device list',
      'project close force',
    ])),
  );
}

async function groups(sections) {
  const file = join(work, 'groups.tmd');
  sections.push(
    ...(await run(['project new default force', 'scene resolution 257', `project save ${file}`])),
  );
  await pollBuild(sections);
  sections.push(...(await run(['group list', 'group list Export', 'group list nomatch'])));

  sections.push(...(await run(['group disable Create your Terrain', 'device list', 'group list'])));
  await dirtyProbe(sections, file);
  sections.push(
    ...(await run([
      'group disable #0',
      'device list',
      'project undo',
      'device list',
      'project redo',
      'device list',
    ])),
  );
  sections.push(...(await run([`project open ${file} force`])));

  sections.push(
    ...(await run([
      'device disable Thermal Weathering',
      'device disable Erosion',
      'device list',
      'group disable #0',
      'device list',
      'group enable #0',
      'device list',
      'group enable Texture & View',
      'device list',
    ])),
  );

  sections.push(
    ...(await run([
      'group disable missing',
      'group enable #99',
      'group disable Welcome to World Machine!',
      'group enable create your terrain',
    ])),
  );

  sections.push(...(await run([`project open ${file} force`])));
  await pollBuild(sections);
  const since = Date.now();
  await timed(sections, ['group build #0']);
  sections.push(await wait(3000));
  await timed(sections, ['build status']);
  sections.push(await wait(3000));
  filesSince(sections, since, 'by group build #0');
  await timed(sections, ['export all']);
  await timed(sections, ['group build missing']);
  sections.push(await wait(2000));
  sections.push(...(await run(['project close force'])));
}

async function v2bAssumptions(sections) {
  const file = join(work, 'assume.tmd');
  sections.push(
    ...(await run(['project new default force', 'scene resolution 257', `project save ${file}`])),
  );
  await pollBuild(sections);

  // B1: long names.
  sections.push(
    ...(await run([
      `snapshot create ${'a'.repeat(64)}`,
      `snapshot create ${'b'.repeat(65)}`,
      `snapshot create ${'c'.repeat(200)}`,
      'snapshot list',
    ])),
  );

  // B3: does a restore bring back the scene?
  sections.push(
    ...(await run(['snapshot create scene257', 'scene resolution 513', 'scene show', 'snapshot list'])),
  );
  const listed = sections.at(-1).lines.find((line) => line.includes("'scene257'"));
  const index = listed?.match(/\[#(\d+)\]/)?.[1] ?? '3';
  sections.push(...(await run([`snapshot restore #${index}`, 'scene show', 'scene list'])));

  // B8 (snapshots): 12 or more rows.
  sections.push(...(await run(Array.from({ length: 9 }, (_, i) => `snapshot create row${i}`))));
  sections.push(...(await run(['snapshot list'])));

  // B5: exportAlways on Height Output, then a group build of each group with devices, listing written files.
  sections.push(
    ...(await run([
      'scene resolution 257',
      `project save ${file}`,
      'param set #1.exportAlways true',
      'param get #1.exportAlways',
      'group list',
    ])),
  );
  await pollBuild(sections);
  for (const group of [0, 1, 2, 4]) {
    const since = Date.now();
    await timed(sections, [`group build #${group}`]);
    sections.push(await waitForLine(/^Building \d+ device\(s\) in group /, 30_000));
    sections.push(await wait(2000));
    filesSince(sections, since, `by group build #${group} with exportAlways true`);
  }

  // B6: a stopped group build at 4097: does its late line come?
  sections.push(...(await run(['param set #1.exportAlways false', 'scene resolution 4097'])));
  await pollBuild(sections);
  await timed(sections, ['group build #0']);
  await timed(sections, ['build stop']);
  sections.push(await waitForLine(/^Building \d+ device\(s\) in group /, 60_000));
  sections.push(await wait(2000));
  sections.push(...(await run(['build status', 'project close force'])));
}

// One tiled build with timings: Build Event lines and tile file mtimes in seconds since `build start tiled`, until
// the end line was seen and no file changed for 30 s, or 180 s pass. With `stopAfterMs`, `build stop` is sent then.
async function tiledTimeline(sections, label, stopAfterMs) {
  const began = Date.now();
  const since = (ms) => ((ms - began) / 1000).toFixed(2);
  const mtimes = new Map();
  const events = [];
  let endAt;
  let stopAt;
  let lastChange = began;
  const record = (line) => {
    events.push(`+${since(Date.now())} s ${scrub(line)}`);
    if (endAt === undefined && /System allowed to sleep again/.test(line)) endAt = Date.now();
  };
  for (const section of await run(['build start tiled'])) for (const line of section.lines) record(line);
  while (Date.now() - began < 180_000) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    for (const line of received.slice(consumed)) if (!LICENCE.test(line)) record(line);
    consumed = received.length;
    for (const path of newFiles(work, 3, began)) {
      const mtime = statSync(path).mtimeMs;
      if (mtimes.get(path) !== mtime) {
        mtimes.set(path, mtime);
        lastChange = Date.now();
      }
    }
    if (stopAfterMs !== undefined && stopAt === undefined && Date.now() - began >= stopAfterMs) {
      stopAt = Date.now();
      events.push(`+${since(stopAt)} s >>> build stop`);
      for (const section of await run(['build stop'])) for (const line of section.lines) record(line);
    }
    if (endAt !== undefined && Date.now() - lastChange > 30_000) break;
  }
  // A tile is complete when the last of its files was written.
  const tiles = new Map();
  for (const [path, mtime] of mtimes) {
    const tile = /_x(\d+)_y(\d+)/.exec(path)?.[0];
    if (tile !== undefined) tiles.set(tile, Math.max(tiles.get(tile) ?? 0, mtime));
  }
  const done = [...tiles.values()].sort((a, b) => a - b);
  const gaps = done.slice(1).map((time, index) => time - (done[index] ?? time));
  const afterEnd = endAt === undefined ? [] : done.filter((time) => time > endAt);
  sections.push({ command: `(events: ${label}, seconds since build start tiled)`, lines: events });
  sections.push({
    command: `(files: ${label}, seconds since build start tiled)`,
    lines: [...mtimes]
      .sort((a, b) => a[1] - b[1])
      .map(([path, mtime]) => `+${since(mtime)} s ${scrub(path)}`),
  });
  sections.push({
    command: `(summary: ${label})`,
    lines: [
      `files ${mtimes.size}, tiles ${done.length}`,
      `stop sent ${stopAt === undefined ? 'never' : `+${since(stopAt)} s`}`,
      `end line ${endAt === undefined ? 'not seen' : `+${since(endAt)} s`}`,
      `first tile done +${done[0] === undefined ? '-' : since(done[0])} s, last tile done +${done.at(-1) === undefined ? '-' : since(done.at(-1))} s`,
      `tiles done after the end line ${afterEnd.length}, last one ${afterEnd.length === 0 || endAt === undefined ? '-' : `${((afterEnd.at(-1) - endAt) / 1000).toFixed(2)} s after it`}`,
      `longest gap between tiles done ${gaps.length === 0 ? '-' : `${(Math.max(...gaps) / 1000).toFixed(2)} s`}`,
    ],
  });
}

async function tiledStopTiming(sections) {
  const file = join(work, 'tiled-timing.tmd');
  sections.push(
    ...(await run(['project new default force', 'scene resolution 1025', `project save ${file}`])),
  );
  await pollBuild(sections);
  askUser(sections, 'STEP 1: in the tiled build settings, set the 8 x 8 tile layout again, then report');
  await waitForTrigger(sections, 'tiles');
  sections.push(...(await run([`project save ${file}`])));
  await tiledTimeline(sections, 'finished tiled build', undefined);
  await tiledTimeline(sections, 'tiled build stopped at 8 s', 8000);
  askUser(sections, 'DONE: the capture closes the project now');
  sections.push(...(await run(['build status', 'project close force'])));
}

async function windowAssumptions(sections) {
  const file = join(work, 'window-assumptions.tmd');
  const listed = await run([
    'project new default force',
    'scene resolution 1025',
    `project save ${file}`,
    'device list',
  ]);
  sections.push(...listed);
  await pollBuild(sections);
  const known = new Set(devices(listed[3].lines).map((device) => device.id));
  const addNew = async (type) => {
    const added = await run([`device add ${type}`, 'device list']);
    sections.push(...added);
    const fresh = devices(added[1].lines).filter((device) => !known.has(device.id));
    for (const device of fresh) known.add(device.id);
    if (fresh[0] === undefined) throw new Error(`device add ${type} added no device`);
    return fresh[0].id;
  };

  // A4: a full build with a device that cannot build (a File Input whose file does not exist).
  const input = await addNew('File Input');
  const output = await addNew('File Output');
  const inputParams = await run([`param list #${input}`]);
  sections.push(...inputParams);
  const filename = params(inputParams[0].lines).find((parameter) => parameter.type === 'filename');
  if (filename === undefined) throw new Error('File Input lists no filename parameter');
  sections.push(
    ...(await run([
      `param set #${input}.${filename.name} ${join(work, 'missing-input.png')}`,
      `wire connect #${input} #${output}`,
      'build start',
    ])),
  );
  sections.push(await waitForLine(/Build Ended/, 120_000));
  sections.push(await wait(12_000));
  sections.push(
    ...(await run(['build status', 'export all', `device delete #${output}`, `device delete #${input}`])),
  );
  sections.push(await wait(3000));

  // B4, B7, B8: groups made in the window.
  askUser(
    sections,
    "STEP 1: in the window, make a group named 'Solo' with exactly one device, two groups both named 'Twin' (if the window allows it), and more groups until there are 10 or more in all",
  );
  await waitForTrigger(sections, 'groups');
  sections.push(
    ...(await run([
      'group list',
      'group list Solo',
      'group list Twin',
      'group disable Solo',
      'group enable Solo',
      'group disable Twin',
      'group list',
    ])),
  );

  // B2: organize, then undo, while the user watches the layout.
  askUser(sections, 'STEP 2: drag a few devices out of place in the window, then report');
  await waitForTrigger(sections, 'messy');
  sections.push(...(await run(['device organize'])));
  askUser(sections, 'STEP 3: report whether the layout changed to the organized one');
  await waitForTrigger(sections, 'organized');
  sections.push(...(await run(['project undo'])));
  askUser(sections, 'STEP 4: report whether your earlier layout came back after the undo');
  await waitForTrigger(sections, 'undone');

  // A2: stop a tiled build with a large layout.
  askUser(
    sections,
    'STEP 5: in the tiled build settings, set a large layout (8 x 8 tiles or more), then report',
  );
  await waitForTrigger(sections, 'tiles');
  sections.push(...(await run([`project save ${file}`])));
  const since = Date.now();
  sections.push(...(await run(['build start tiled'])));
  sections.push(await wait(8000));
  sections.push({ command: '(tiles written before the stop)', lines: newFiles(work, 3, since).map(scrub) });
  sections.push(...(await run(['build stop'])));
  sections.push(await wait(20_000));
  sections.push({
    command: '(tiles written by 20 s after the stop)',
    lines: newFiles(work, 3, since).map(scrub),
  });
  sections.push(...(await run(['build status'])));
  askUser(sections, 'DONE: the capture closes the project now');
  sections.push(...(await run(['project close force'])));
}

// Shows the user what to do in the World Machine window, in the log and in the capture.
function askUser(sections, step) {
  console.log(`\n=== ${step}\n`);
  sections.push({ command: `(asked the user: ${step})`, lines: [] });
}

// Waits until the file `name` exists in WM_CAPTURE_TRIGGERS: the operator creates it once the user reports the window
// action done, so the capture's timing follows the user, not a guess. Up to 15 minutes.
async function waitForTrigger(sections, name) {
  const folder = process.env.WM_CAPTURE_TRIGGERS;
  if (!folder) throw new Error('Set WM_CAPTURE_TRIGGERS to a folder for the step trigger files');
  const began = Date.now();
  while (!existsSync(join(folder, name))) {
    if (Date.now() - began > 900_000) throw new Error(`no trigger '${name}' within 15 minutes`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  sections.push({
    command: `(trigger ${name} after ${Math.round((Date.now() - began) / 1000)} s)`,
    lines: [],
  });
}

async function windowBuilds(sections) {
  const file = join(work, 'window-builds.tmd');
  sections.push(
    ...(await run([
      'project new default force',
      'scene resolution 1025',
      `project save ${file}`,
      'export all',
    ])),
  );
  await pollBuild(sections);
  // A1, full build: anything printed while it ran, then whether its outputs became exportable.
  askUser(sections, 'STEP 1: start a full build from the World Machine window and let it finish');
  await waitForTrigger(sections, 'step1');
  sections.push(await wait(5000));
  sections.push(...(await run(['build status', 'export all'])));
  // R12: a running window-started full build stopped from the console, then a console tiled build at once.
  sections.push(...(await run(['scene resolution 4097'])));
  askUser(sections, 'STEP 2: start a full build from the World Machine window and leave it running');
  await waitForTrigger(sections, 'step2');
  sections.push(await wait(10_000));
  sections.push(...(await run(['build status', 'build stop'])));
  sections.push(await wait(5000));
  sections.push(...(await run(['build start tiled'])));
  sections.push(await wait(30_000));
  sections.push(...(await run(['build status', 'scene resolution 1025'])));
  // A1, tiled build.
  askUser(sections, 'STEP 3: start a tiled build from the World Machine window and let it finish');
  await waitForTrigger(sections, 'step3');
  sections.push(await wait(5000));
  sections.push(...(await run(['build status'])));
  askUser(sections, 'DONE: the capture closes the project now');
  sections.push(...(await run(['project close force'])));
}

async function p114TemplatePaths(sections) {
  const dir = join(work, 'p11');
  // Folders a backslash would name if World Machine read it as a separator.
  mkdirSync(join(dir, 'a'), { recursive: true });
  mkdirSync(join(dir, 'x'), { recursive: true });
  const file = join(dir, 'p11.tmd');
  sections.push(
    ...(await run(['project new default force', 'scene resolution 257', `project save ${file}`])),
  );
  await pollBuild(sections);
  await timed(sections, ['build start']);
  sections.push(await waitForLine(/^Build started\.$/, 60_000));
  const parent = dirname(work);
  const mask = (path) => scrub(path).replaceAll(parent, '<TMP>');
  const probeFiles = (since) =>
    [
      ...newFiles(work, 4, since),
      ...newFiles(parent, 1, since),
      ...newFiles(homedir(), 4, since),
      ...newFiles(process.cwd(), 2, since),
    ].filter((path, index, all) => all.indexOf(path) === index);
  const templates = [
    'p11-baseline-<res>.png',
    '~/wm-p11-tilde-<res>.png',
    'a\\wm-p11-backslash-<res>.png',
    'x\\..\\wm-p11-backslash-dotdot-<res>.png',
    'x\\..\\..\\wm-p11-backslash-escape-<res>.png',
    '$HOME/wm-p11-env-<res>.png',
    '%HOME%/wm-p11-percent-<res>.png',
    'a//wm-p11-double-slash-<res>.png',
    // A doubled backslash, in case the console reads `\\` as one literal backslash (a single one is stripped).
    'a\\\\wm-p11-dbl-backslash-<res>.png',
    'x\\\\..\\\\..\\\\wm-p11-dbl-escape-<res>.png',
    `${join(dir, 'a')}/wm-p11-absolute-<res>.png`,
  ];
  for (const template of templates) {
    sections.push(
      ...(await run([`param set #1.filename ${template}`, 'param get #1.filename', 'export list'])),
    );
    const since = Date.now();
    let exported = await run(['export all']);
    if (exported[0].lines.some((line) => /not built/i.test(line))) {
      sections.push(...exported);
      await timed(sections, ['build start']);
      sections.push(await waitForLine(/^Build started\.$/, 60_000));
      exported = await run(['export all']);
    }
    sections.push(...exported);
    sections.push(await wait(1500));
    const found = probeFiles(since);
    sections.push({ command: `(output files written for filename ${template})`, lines: found.map(mask) });
    for (const path of found) {
      if (!path.startsWith(work) && /wm-p11-/.test(path)) {
        unlinkSync(path);
        sections.push({ command: '(removed probe file outside <WORK>)', lines: [mask(path)] });
      }
    }
  }
  sections.push(...(await run(['project close force'])));
}

async function v3RenameTypes(sections) {
  const file = process.env.WM_RENAME_CANDIDATES;
  if (!file)
    throw new Error('Set WM_RENAME_CANDIDATES to a file of candidate device type names, one per line');
  const candidates = readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  // Phase A: which candidates are device types. Only accepted adds are recorded.
  sections.push(...(await run(['project new default force'])));
  const types = [];
  for (let start = 0; start < candidates.length; start += 50) {
    const chunk = candidates.slice(start, start + 50);
    const answers = await run(chunk.map((type) => `device add ${type}`));
    answers.forEach((answer, index) => {
      if (answer.lines.some((line) => /^Added '/.test(line))) {
        sections.push(answer);
        types.push(chunk[index]);
      }
    });
  }
  sections.push({
    command: '(phase A)',
    lines: [`${candidates.length} names tried, ${types.length} accepted by device add`],
  });
  // Phase B: each accepted type alone in a fresh default project: add, rename, read back, delete.
  const listed = await run(['project new default force', 'device list']);
  sections.push(...listed);
  const known = new Set(devices(listed[1].lines).map((device) => device.id));
  const outcomes = [];
  for (const type of types) {
    const added = await run([`device add ${type}`, 'device list']);
    sections.push(...added);
    const fresh = devices(added[1].lines).find((device) => !known.has(device.id));
    if (fresh === undefined) {
      outcomes.push(`${type}: no new device in the list`);
      continue;
    }
    const name = `Probe ${fresh.id}`;
    const renamed = await run([
      `device rename #${fresh.id} ${name}`,
      'device list',
      `device delete #${fresh.id}`,
    ]);
    sections.push(...renamed);
    const row = devices(renamed[1].lines).find((device) => device.id === fresh.id);
    outcomes.push(
      `${type}: default '${fresh.name}', rename ${row?.name === name ? 'applied' : `ignored (list shows '${row?.name}')`}`,
    );
  }
  sections.push({ command: '(summary)', lines: outcomes });
  sections.push(...(await run(['project close force'])));
}

async function v3RenameProbe(sections) {
  const listed = await run(['project new default force', 'device list']);
  sections.push(...listed);
  const known = new Set(devices(listed[1].lines).map((device) => device.id));
  // The new device is the one the list after the add shows for the first time.
  const addNew = async (type) => {
    const added = await run([`device add ${type}`, 'device list']);
    sections.push(...added);
    const fresh = devices(added[1].lines).filter((device) => !known.has(device.id));
    for (const device of fresh) known.add(device.id);
    if (fresh[0] === undefined) throw new Error(`device add ${type} added no device`);
    return fresh[0].id;
  };
  const renameAndRead = async (id, name) =>
    sections.push(
      ...(await run([`device rename #${id} ${name}`, 'device list', `device select #${id}`, 'device info'])),
    );
  const combiner = await addNew('Combiner');
  await renameAndRead(combiner, 'Mix');
  await renameAndRead(combiner, 'Blend');
  const gradient = await addNew('Gradient');
  await renameAndRead(gradient, 'Mix');
  const second = await addNew('Combiner');
  await renameAndRead(second, 'Blend 2');
  sections.push(...(await run(['project close force'])));
}

async function v3Assumptions(sections) {
  const file = join(work, 'v3.tmd');
  sections.push(
    ...(await run(['project new default force', 'scene resolution 257', `project save ${file}`])),
  );
  await pollBuild(sections);
  const listed = await run(['device list']);
  sections.push(...listed);
  const all = devices(listed[0].lines);
  const idOf = (name) => {
    const device = all.find((candidate) => candidate.name === name);
    if (device === undefined) throw new Error(`the default project has no device '${name}'`);
    return device.id;
  };
  const known = new Set(all.map((device) => device.id));
  // The new device is the one the list after the add shows for the first time; a failed add yields undefined.
  const addNew = async (type) => {
    const added = await run([`device add ${type}`, 'device list']);
    sections.push(...added);
    const fresh = devices(added[1].lines).filter((device) => !known.has(device.id));
    for (const device of fresh) known.add(device.id);
    return fresh[0];
  };
  const erosion = idOf('Erosion');
  const flow = idOf('Flow Restructure');
  const thermal = idOf('Thermal Weathering');
  // C1: the state before, a snapshot, one change of each kind apply_graph makes, the restore, and the state after.
  sections.push(
    ...(await run([
      `param list #${erosion}`,
      `wire list #${erosion}`,
      `wire list #${thermal}`,
      'snapshot create C1',
    ])),
  );
  const gradient = await addNew('Gradient');
  if (gradient === undefined) throw new Error('device add Gradient added no device');
  sections.push(
    ...(await run([
      `param set #${erosion}.Amount 0.25`,
      `param set #${erosion}.maskSoil false`,
      `param set #${erosion}.soilMask 0`,
    ])),
  );
  // soilMask defaults to 'Presence Mask' and its index is unknown, so 0 may be a no-op. Check it, and set 1 if it was.
  const soilMaskCheck = await run([`param get #${erosion}.soilMask`]);
  sections.push(...soilMaskCheck);
  if (soilMaskCheck[0].lines.some((line) => line.includes('Presence Mask'))) {
    sections.push(...(await run([`param set #${erosion}.soilMask 1`, `param get #${erosion}.soilMask`])));
  }
  sections.push(
    ...(await run([
      `wire disconnect #${flow} #${erosion}`,
      `wire connect #${gradient.id} #${erosion}`,
      `device disable #${erosion}`,
      `device delete #${thermal}`,
      'device list',
      `param list #${erosion}`,
      `wire list #${erosion}`,
      'snapshot restore C1',
      'device list',
      `param list #${erosion}`,
      `wire list #${erosion}`,
      `wire list #${thermal}`,
      `device select #${thermal}`,
      'device info',
    ])),
  );
  // The restore removed the C1 Gradient, so the id set is rebuilt from the list before C2 adds devices.
  const afterRestore = await run(['device list']);
  sections.push(...afterRestore);
  known.clear();
  for (const device of devices(afterRestore[0].lines)) known.add(device.id);
  // C2: the type `device info` reports, for types named after themselves and for two that are not (fact 40).
  for (const type of ['Gradient', 'Advanced Perlin', 'Layout Generator', 'File Output']) {
    const device = await addNew(type);
    if (device === undefined) {
      sections.push({ command: `(no new device for ${type})`, lines: [] });
      continue;
    }
    sections.push(
      ...(await run([
        `device select #${device.id}`,
        'device info',
        `param list #${device.id}`,
        `wire list #${device.id}`,
      ])),
    );
  }
  sections.push(...(await run(['project close force'])));
}

async function diagnostic(kind) {
  const sections = [];
  try {
    const file = join(work, `diag-${kind}.tmd`);
    const resolution = kind === 'group' || kind === 'export-twice' ? 257 : 4097;
    sections.push(
      ...(await run(['project new default force', `scene resolution ${resolution}`, `project save ${file}`])),
    );
    await pollBuild(sections);
    if (kind === 'group') {
      await timed(sections, ['group build #0']);
      sections.push(await waitForLine(/^Building \d+ device\(s\) in group /, 30_000));
    } else if (kind === 'group-stop') {
      await timed(sections, ['group build #0']);
      await timed(sections, ['build stop']);
      sections.push(await wait(3000));
    } else if (kind === 'full-stop') {
      await timed(sections, ['build start']);
      await timed(sections, ['build stop']);
      sections.push(await waitForLine(/^Build started\.$/, 15_000));
    } else {
      sections.push(...(await run(['param set #1.exportAlways true'])));
      for (const label of ['first', 'second']) {
        const since = Date.now();
        await timed(sections, ['group build #1']);
        sections.push(await waitForLine(/^Building \d+ device\(s\) in group /, 30_000));
        sections.push(await wait(1500));
        filesSince(sections, since, `by the ${label} group build #1`);
      }
      const since = Date.now();
      await timed(sections, ['build start']);
      sections.push(await waitForLine(/^Build started\.$/, 30_000));
      sections.push(await wait(1500));
      filesSince(sections, since, 'by a full build after the group builds');
      sections.push(...(await run(['param set #1.exportAlways false'])));
    }
  } catch (error) {
    sections.push({ command: '(scenario stopped)', lines: [scrub(error.message)] });
  }
  return sections;
}

// `npm run capture-fixtures -- <name> ...` captures only the named scenarios (system info always runs first).
const only = process.argv.slice(2);
const selected =
  only.length === 0 ? scenarios : scenarios.filter(([name]) => name === 'system-info' || only.includes(name));

function check(name, sections) {
  if (name === 'v1-result-before-next-error') {
    const [info, bogus] = sections;
    const ok =
      info.lines.some((l) => l.includes('System Info')) && !info.lines.some((l) => l.startsWith('Error: '));
    console.log(`V1 check: ${ok && bogus.lines.some((l) => l.startsWith('Error: ')) ? 'PASS' : 'FAIL'}`);
  }
  if (name === 'v2-batch-after-error') {
    const [bogus, info] = sections;
    const ok =
      bogus.lines.some((l) => l.startsWith('Error: ')) && info.lines.some((l) => l.includes('System Info'));
    console.log(`V2 check: ${ok ? 'PASS' : 'FAIL'}`);
  }
}

try {
  await waitFor((line) => line.includes(READY), 120_000, 'startup');
  // The start-up log is not part of any batch.
  consumed = received.length;
  let outDir;
  for (const [name, scenario] of selected) {
    const sections = await scenario();
    if (name === 'system-info') {
      const build = sections[0].lines.join('\n').match(/Build (\d+)/)?.[1];
      if (!build) throw new Error('could not read the build number from system info');
      outDir = join('test', 'fixtures', `wm-${build}`, 'raw');
      mkdirSync(outDir, { recursive: true });
      // A filtered run leaves the committed system-info capture untouched.
      if (only.length > 0) continue;
    }
    writeFileSync(join(outDir, `${name}.txt`), render(sections));
    console.log(`captured ${name}`);
    check(name, sections);
  }
  console.log('V8 (licence checkout failure) cannot be provoked by this script; record it when observed.');
} finally {
  // Lines wait behind unread input (spec fact 14), so nudge with empty lines until the child exits.
  if (child.exitCode === null && child.signalCode === null) {
    // Close first: quitting a modified project opens a dialog and keeps the licence seat (spec facts 19-20).
    child.stdin.write('project close force\n');
    await new Promise((resolve) => setTimeout(resolve, 100));
    child.stdin.write('system quit force\n');
    for (let i = 0; i < 20 && child.exitCode === null && child.signalCode === null; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      child.stdin.write('\n');
    }
  }
  child.stdin.end();
}
