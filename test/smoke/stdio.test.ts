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
      'add_device',
      'configure_scene',
      'connect_devices',
      'create_project',
      'delete_device',
      'disconnect_devices',
      'get_device',
      'get_scene',
      'get_world_machine_status',
      'inspect_project',
      'list_devices',
      'open_project',
      'redo',
      'rename_device',
      'save_project',
      'set_device_enabled',
      'undo',
      'update_device_parameters',
    ]);

    const before = await client.callTool({ name: 'get_world_machine_status', arguments: {} });
    expect(before.structuredContent).toMatchObject({ configured: true, session: { state: 'notRunning' } });
    expect(record.lines()).toEqual([]);

    const list = await client.callTool({ name: 'list_devices', arguments: {} });
    expect((list.structuredContent as { devices: unknown[] }).devices).toHaveLength(17);

    // The fake's first new id in the sample project is #536 (spec fact 30).
    const added = await client.callTool({
      name: 'add_device',
      arguments: { type: 'Gradient', name: 'Grad A' },
    });
    expect(added.isError).toBeFalsy();
    expect(added.structuredContent).toMatchObject({
      device: { id: 536, name: 'Grad A', kind: 'Gradient' },
      session: { state: 'ready', dirty: true },
    });

    // Undo would mark the project dirty (spec §6); a discarding create_project leaves a clean
    // session so the server shuts down without the unsaved-changes warning.
    const cleaned = await client.callTool({
      name: 'create_project',
      arguments: { discard_unsaved: true },
    });
    expect(cleaned.isError).toBeFalsy();
    expect(cleaned.structuredContent).toMatchObject({
      session: { dirty: false, binding: { kind: 'fresh' } },
    });
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
