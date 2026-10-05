import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FAKE_WM, FIXTURES, isAlive, recorder, waitUntil } from '../support/fake-wm.js';

const MAIN = fileURLToPath(new URL('../../dist/main.js', import.meta.url));

type Exit = { code: number | null; signal: NodeJS.Signals | null };

type Server = {
  child: ChildProcessWithoutNullStreams;
  stdout(): string;
  stderr(): string;
  exited: Promise<Exit>;
  request(method: string, params: unknown): Promise<unknown>;
};

function launch(env: Record<string, string>): Server {
  const child = spawn(process.execPath, [MAIN], {
    env: {
      PATH: process.env.PATH ?? '',
      FAKE_WM_FIXTURES: FIXTURES,
      WORLD_MACHINE_LOG_LEVEL: 'warn',
      ...env,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let out = '';
  let err = '';
  const waiting = new Map<number, (message: unknown) => void>();
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    err += chunk;
  });
  let pending = '';
  child.stdout.on('data', (chunk: string) => {
    out += chunk;
    pending += chunk;
    let newline = pending.indexOf('\n');
    while (newline >= 0) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      newline = pending.indexOf('\n');
      try {
        const message = JSON.parse(line) as { id?: number };
        if (message.id !== undefined) waiting.get(message.id)?.(message);
      } catch {
        // Not JSON: left in stdout() for the caller's assertions.
      }
    }
  });
  const exited = new Promise<Exit>((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  let nextId = 1;
  return {
    child,
    stdout: () => out,
    stderr: () => err,
    exited,
    request: (method, params) =>
      new Promise((resolve) => {
        const id = nextId++;
        waiting.set(id, resolve);
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      }),
  };
}

async function handshake(server: Server): Promise<void> {
  await server.request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'smoke-signals', version: '0.0.0' },
  });
  server.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
}

function fakeServer(extra: Record<string, string> = {}) {
  const record = recorder();
  const server = launch({
    WORLD_MACHINE_BIN: FAKE_WM,
    WORLD_MACHINE_ALLOWED_ROOTS: mkdtempSync(join(tmpdir(), 'smoke-')),
    FAKE_WM_RECORD: record.path,
    ...extra,
  });
  return { record, server };
}

async function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} did not happen within ${ms} ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

describe('invalid configuration', () => {
  it.each([
    ['WORLD_MACHINE_IDLE_TIMEOUT_MS', 'soon', 'WORLD_MACHINE_IDLE_TIMEOUT_MS must be an integer between 0'],
    ['WORLD_MACHINE_LOG_LEVEL', 'loud', 'WORLD_MACHINE_LOG_LEVEL must be one of error, warn, info, debug'],
  ])('exits 1 with a stderr message and a silent stdout for a bad %s', async (name, value, fragment) => {
    const server = launch({ [name]: value });
    const exit = await withTimeout(server.exited, 10_000, 'exit');
    expect(exit).toEqual({ code: 1, signal: null });
    expect(server.stderr()).toContain(`[worldmachine-mcp] error: ${fragment}`);
    expect(server.stdout()).toBe('');
  });
});

describe.each(['SIGTERM', 'SIGINT'] as const)('%s', (signal) => {
  it('closes the project then quits World Machine and exits 0', async () => {
    const { record, server } = fakeServer();
    await handshake(server);
    await server.request('tools/call', { name: 'list_devices', arguments: {} });
    await waitUntil(() => record.pids().length > 0, 5_000);
    const fakePids = record.pids();

    server.child.kill(signal);
    const exit = await withTimeout(server.exited, 5_000, 'exit');

    expect(exit).toEqual({ code: 0, signal: null });
    expect(record.lines().filter((line) => /^(project close|system quit)/.test(line))).toEqual([
      'project close force',
      'system quit force',
    ]);
    await waitUntil(() => !fakePids.some(isAlive), 3_000);
  });

  it('exits 0 promptly when World Machine was never started', async () => {
    const { record, server } = fakeServer();
    await handshake(server);
    await server.request('tools/call', { name: 'get_world_machine_status', arguments: {} });

    server.child.kill(signal);
    const exit = await withTimeout(server.exited, 2_000, 'exit');

    expect(exit).toEqual({ code: 0, signal: null });
    expect(record.lines()).toEqual([]);
    expect(record.pids()).toEqual([]);
  });

  it('exits 0 on a repeated signal once SIGKILL has removed World Machine', async () => {
    const { record, server } = fakeServer({ FAKE_WM_QUIT_DELAY_MS: '20000' });
    await handshake(server);
    await server.request('tools/call', { name: 'list_devices', arguments: {} });
    await waitUntil(() => record.pids().length > 0, 5_000);
    const fakePids = record.pids();

    server.child.kill(signal);
    await waitUntil(() => record.lines().includes('system quit force'), 3_000);
    const began = Date.now();
    server.child.kill(signal);
    const exit = await withTimeout(server.exited, 3_000, 'exit');

    expect(exit).toEqual({ code: 0, signal: null });
    expect(Date.now() - began).toBeLessThan(3_000);
    await waitUntil(() => !fakePids.some(isAlive), 3_000);
    expect(isAlive(server.child.pid ?? 0)).toBe(false);
  });
});
