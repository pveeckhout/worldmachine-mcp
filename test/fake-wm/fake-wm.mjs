#!/usr/bin/env node
// Test double that speaks the World Machine --cli console over pipes. Errors go to stderr like the real one.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
if (startup === 'display') {
  out('qt.qpa.xcb: could not connect to display \n');
  exit(1);
}
if (startup === 'ok') log('Info', 'Startup: Completed. Transferring control into event loop.');

let hung = false;
let dirty = env.FAKE_WM_DIRTY_AT_START === '1';
let selected = false;
// 'sample' is the 17-device startup project; 'empty' follows a blank project, a close, or a failed open.
let project = 'sample';
const switchTo = (next) => {
  project = next;
  selected = false;
  dirty = false;
};
const ERODE = new Set(['Erosion', '#35']);
const isErosion = (ref) => project === 'sample' && ERODE.has(ref);
const notFound = (ref) => process.stderr.write(`Error: Error: Device not found: '${ref}'\n`);
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
  if (command === env.FAKE_WM_DELAY_ON) await sleep(Number(env.FAKE_WM_DELAY_MS ?? '0'));
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
    if (project === 'empty') return void out('No devices in the current project.\n');
    const lines = fixture('device-list.txt').split('\n');
    if (env.FAKE_WM_INTERLEAVE === '1')
      lines.splice(3, 0, '[Info       ] QIODevice::read (QSslSocket): device not open');
    out(lines.join('\n'));
    return;
  }
  // Outputs as captured in test/fixtures/wm-4067/raw (V3, V7).
  if (command.startsWith('project open ')) {
    if (env.FAKE_WM_OPEN_ERROR) {
      // Spec fact 17: a failed open leaves an empty project.
      switchTo('empty');
      out('Failed to open project.\n');
    } else {
      switchTo('sample');
      out(`Opened: ${command.slice('project open '.length).replace(/ force$/, '')}\n`);
    }
    return;
  }
  if (command.startsWith('project new default') || command.startsWith('project new blank')) {
    if (env.FAKE_WM_NEW_SILENT === '1' && command.startsWith('project new default')) return;
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
    out(`Project saved to: ${target}\n`);
    return;
  }
  if (command === 'project undo' || command === 'project redo') {
    dirty = true;
    out(command === 'project undo' ? 'Undo performed.\n' : 'Redo performed.\n');
    return;
  }
  if (command.startsWith('param set ')) {
    dirty = true;
    const [ref, ...value] = command.slice('param set '.length).split(' ');
    out(`Set ${ref} = ${value.join(' ')}\n`);
    return;
  }
  if (command.startsWith('device add ')) {
    dirty = true;
    out(`Added '${command.slice('device add '.length)}'\n`);
    return;
  }
  if (command.startsWith('device select ')) {
    const ref = command.slice('device select '.length);
    if (!isErosion(ref)) return void notFound(ref);
    selected = true;
    out('Selected: Erosion\n');
    return;
  }
  if (command === 'device info') {
    out(selected ? fixture('device-info-erosion.txt') : 'No device selected.\n');
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
  const blank = project === 'empty';
  if (command === 'scene show') return void out(fixture(blank ? 'scene-show-blank.txt' : 'scene-show.txt'));
  if (command === 'scene list') return void out(fixture(blank ? 'scene-list-blank.txt' : 'scene-list.txt'));
  if (command === 'group list')
    return void out(blank ? 'No groups in the current project.\n' : fixture('group-list.txt'));
  process.stderr.write(`Error: Unknown command: '${command}'. Type 'help' for a list of commands.\n`);
}
