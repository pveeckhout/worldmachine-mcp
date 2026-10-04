#!/usr/bin/env node
// Test double that speaks the World Machine --cli console over pipes. Errors go to stderr like the real one.
import { appendFileSync, readFileSync } from 'node:fs';
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
log('Info', 'World Machine Program Log');
log('Info', 'License Manager.Checkout: License checkout successful (product wmpro)');
const startup = env.FAKE_WM_STARTUP ?? 'ok';
if (startup === 'exit') {
  log('Info', 'Startup: Loading plugins');
  out('fatal: simulated startup failure\n');
  exit(3);
}
if (startup === 'ok') log('Info', 'Startup: Completed. Transferring control into event loop.');

let hung = false;
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
process.stdin.on('end', () => exit(0));

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
    const lines = fixture('device-list.txt').split('\n');
    if (env.FAKE_WM_INTERLEAVE === '1')
      lines.splice(3, 0, '[Info       ] QIODevice::read (QSslSocket): device not open');
    out(lines.join('\n'));
    return;
  }
  // Outputs as captured in test/fixtures/wm-4067/raw (V3, V7).
  if (command.startsWith('project open ')) {
    out(
      env.FAKE_WM_OPEN_ERROR
        ? 'Failed to open project.\n'
        : `Opened: ${command.slice('project open '.length)}\n`,
    );
    return;
  }
  if (command.startsWith('project new default')) {
    out('Created new default project.\n');
    return;
  }
  process.stderr.write(`Error: Unknown command: '${command}'. Type 'help' for a list of commands.\n`);
}
