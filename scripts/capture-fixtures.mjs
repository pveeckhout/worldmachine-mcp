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
];

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
  for (const [name, scenario] of scenarios) {
    const sections = await scenario();
    if (name === 'system-info') {
      const build = sections[0].lines.join('\n').match(/Build (\d+)/)?.[1];
      if (!build) throw new Error('could not read the build number from system info');
      outDir = join('test', 'fixtures', `wm-${build}`, 'raw');
      mkdirSync(outDir, { recursive: true });
    }
    writeFileSync(join(outDir, `${name}.txt`), render(sections));
    console.log(`captured ${name}`);
    check(name, sections);
  }
  console.log('V8 (licence checkout failure) cannot be provoked by this script; record it when observed.');
} finally {
  // Lines wait behind unread input (spec fact 14), so nudge with empty lines until the child exits.
  if (child.exitCode === null && child.signalCode === null) {
    child.stdin.write('system quit force\n');
    for (let i = 0; i < 20 && child.exitCode === null && child.signalCode === null; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      child.stdin.write('\n');
    }
  }
  child.stdin.end();
}
