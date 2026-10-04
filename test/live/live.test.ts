import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { FsPathPolicy } from '../../src/adapter/out/fs/path-policy.js';
import { resolveExecutable } from '../../src/adapter/out/worldmachine/locator.js';
import { throwIfFailed } from '../../src/adapter/out/worldmachine/raw-response.js';
import { WorldMachineGraphReader } from '../../src/adapter/out/worldmachine/world-machine-graph-reader.js';
import { WorldMachineProcess } from '../../src/adapter/out/worldmachine/world-machine-process.js';
import { WorldMachineSession } from '../../src/adapter/out/worldmachine/world-machine-session.js';
import { createLogger } from '../../src/logger.js';

const executable = resolveExecutable(process.env.WORLD_MACHINE_BIN ?? null);
const LIVE = process.env.WM_LIVE === '1' && executable !== null;

describe.skipIf(!LIVE)('live World Machine', () => {
  const logger = createLogger('warn');
  const session = new WorldMachineSession({
    executable,
    defaultProject: undefined,
    pathPolicy: new FsPathPolicy([mkdtempSync(join(tmpdir(), 'wm-live-'))]),
    commandTimeoutMs: 30_000,
    idleTimeoutMs: 0,
    logger,
    startProcess: (bin, signal, onSpawn) =>
      WorldMachineProcess.start({ bin, readyTimeoutMs: 120_000, logger, signal, onSpawn }),
  });
  const reader = new WorldMachineGraphReader(session);
  afterAll(() => session.shutdown(), 30_000);

  it('starts, reports the build, and binds a fresh project', async () => {
    await session.ensureRunning();
    const status = session.status();
    expect(status.session).toEqual({ state: 'ready', binding: { kind: 'fresh' }, dirty: false });
    expect(status.systemInfo?.build).toBeGreaterThan(0);
  }, 180_000);

  it('lists the devices of the fresh project', async () => {
    const devices = await reader.listDevices();
    expect(Array.isArray(devices)).toBe(true);
    for (const device of devices) expect(device.id).toBeGreaterThan(0);
  }, 60_000);

  it('reports WM_COMMAND_FAILED for an unknown command and keeps working afterwards', async () => {
    const response = await session.executeOne('live_test_unknown_command');
    let code: string | undefined;
    try {
      throwIfFailed(response);
    } catch (error) {
      code = (error as { code?: string }).code;
    }
    expect(code).toBe('WM_COMMAND_FAILED');
    expect(session.status().session.state).toBe('ready');
    await reader.listDevices();
  }, 60_000);

  it('frames a mixed batch in order: result, error, result', async () => {
    const [info, bogus, list] = await session.execute([
      'system info',
      'live_test_unknown_command',
      'device list',
    ]);
    expect(info?.output.join('\n')).toContain('Build');
    expect(info?.errors).toEqual([]);
    expect(bogus?.errors[0]).toMatch(/^Error: /);
    expect(list?.output[0]).toMatch(/^Devices \(\d+ total\):$/);
  }, 60_000);

  it('returns the licence seat on shutdown', async () => {
    await session.shutdown();
    expect(session.status().session).toEqual({ state: 'notRunning' });
  }, 30_000);
});
