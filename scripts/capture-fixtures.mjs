#!/usr/bin/env node
// Records raw World Machine CLI transcripts for parser fixtures and for spec items V1-V8.
// Needs a licensed local World Machine. Usage: WORLD_MACHINE_BIN=/path/to/wm npm run capture-fixtures
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
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
    .replaceAll(homedir(), '<HOME>')
    .replace(/\/tmp\/\.mount_[^/\s]+/g, '<APPDIR>');
}

async function run(commands) {
  const start = received.length;
  const id = Math.random().toString(16).slice(2, 10);
  const echo = (i) => `Error: Unknown command: '__end_${id}_${i}'`;
  child.stdin.write(commands.map((command, i) => `${command}\n__end_${id}_${i}\n`).join(''));
  // World Machine reads only the first new line per stdin read; empty lines flush the rest (spec facts 14-15).
  const nudge = setInterval(() => child.stdin.write('\n'), 100);
  try {
    await waitFor((line) => line.startsWith(echo(commands.length - 1)), 60_000, `batch ${id}`);
  } finally {
    clearInterval(nudge);
  }
  const sections = commands.map((command) => ({ command, lines: [] }));
  let index = 0;
  for (const line of received.slice(start)) {
    if (line.startsWith(echo(index))) {
      index++;
      continue;
    }
    if (index < sections.length && !LICENCE.test(line)) sections[index].lines.push(scrub(line));
  }
  return sections;
}

function render(sections) {
  return `${sections.map(({ command, lines }) => [`>>> ${scrub(command)}`, ...lines, '<<<'].join('\n')).join('\n')}\n`;
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
];

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
