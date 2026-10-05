import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { describe, expect, it } from 'vitest';
import { FAKE_WM, FIXTURES, isAlive, recorder, waitUntil } from '../support/fake-wm.js';

const MAIN = fileURLToPath(new URL('../../dist/main.js', import.meta.url));

async function startServer(env: Record<string, string>) {
  const client = new Client({ name: 'smoke', version: '0.0.0' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [MAIN],
      env: {
        PATH: process.env.PATH ?? '',
        FAKE_WM_FIXTURES: FIXTURES,
        WORLD_MACHINE_LOG_LEVEL: 'warn',
        ...env,
      },
    }),
  );
  return client;
}

describe('stdio server', () => {
  it('serves tools over stdio against the fake World Machine', async () => {
    const record = recorder();
    const client = await startServer({
      WORLD_MACHINE_BIN: FAKE_WM,
      WORLD_MACHINE_ALLOWED_ROOTS: mkdtempSync(join(tmpdir(), 'smoke-')),
      FAKE_WM_RECORD: record.path,
    });
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'create_project',
      'get_device',
      'get_scene',
      'get_world_machine_status',
      'inspect_project',
      'list_devices',
      'open_project',
      'redo',
      'save_project',
      'undo',
    ]);

    const before = await client.callTool({ name: 'get_world_machine_status', arguments: {} });
    expect(before.structuredContent).toMatchObject({ configured: true, session: { state: 'notRunning' } });
    expect(record.lines()).toEqual([]);

    const list = await client.callTool({ name: 'list_devices', arguments: {} });
    expect((list.structuredContent as { devices: unknown[] }).devices).toHaveLength(17);
    await client.close();
  });

  it('quits World Machine when the client disconnects', async () => {
    const record = recorder();
    const client = await startServer({
      WORLD_MACHINE_BIN: FAKE_WM,
      WORLD_MACHINE_ALLOWED_ROOTS: mkdtempSync(join(tmpdir(), 'smoke-')),
      FAKE_WM_RECORD: record.path,
    });
    await client.callTool({ name: 'list_devices', arguments: {} });
    await client.close();
    await waitUntil(() => record.lines().includes('system quit force'), 10_000);
  });

  it('leaves no World Machine behind shortly after close, even when it quits slowly', async () => {
    const record = recorder();
    const client = await startServer({
      WORLD_MACHINE_BIN: FAKE_WM,
      WORLD_MACHINE_ALLOWED_ROOTS: mkdtempSync(join(tmpdir(), 'smoke-')),
      FAKE_WM_RECORD: record.path,
      FAKE_WM_QUIT_DELAY_MS: '20000',
    });
    await client.callTool({ name: 'list_devices', arguments: {} });
    await client.close();
    await waitUntil(() => record.pids().length > 0 && !record.pids().some(isAlive), 3_000);
  });

  it('reports NOT_CONFIGURED when WORLD_MACHINE_BIN is missing', async () => {
    const client = await startServer({ WORLD_MACHINE_ALLOWED_ROOTS: mkdtempSync(join(tmpdir(), 'smoke-')) });
    const status = await client.callTool({ name: 'get_world_machine_status', arguments: {} });
    expect(status.structuredContent).toMatchObject({ configured: false, executable: null });
    const list = await client.callTool({ name: 'list_devices', arguments: {} });
    expect(list.isError).toBe(true);
    expect((list.content as { text: string }[])[0]?.text).toContain('NOT_CONFIGURED');
    await client.close();
  });
});
