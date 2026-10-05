import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FsPathPolicy } from '../../../../src/adapter/out/fs/path-policy.js';
import { WorldMachineGraphReader } from '../../../../src/adapter/out/worldmachine/world-machine-graph-reader.js';
import { WorldMachineProcess } from '../../../../src/adapter/out/worldmachine/world-machine-process.js';
import { WorldMachineSession } from '../../../../src/adapter/out/worldmachine/world-machine-session.js';
import { captureLogger, FAKE_WM, fakeEnv, recorder } from '../../../support/fake-wm.js';

const lines = (name: string) =>
  readFileSync(new URL(`../../../fixtures/wm-4067/${name}`, import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => line !== '');

const sessions: WorldMachineSession[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.shutdown()));
});

function reader(extra: Record<string, string> = {}) {
  const record = recorder();
  const logger = captureLogger();
  const env = fakeEnv({ FAKE_WM_RECORD: record.path, ...extra });
  const session = new WorldMachineSession({
    executable: FAKE_WM,
    defaultProject: undefined,
    pathPolicy: new FsPathPolicy([mkdtempSync(join(tmpdir(), 'reader-'))]),
    commandTimeoutMs: 2_000,
    idleTimeoutMs: 0,
    logger,
    startProcess: (bin, signal, onSpawn) =>
      WorldMachineProcess.start({ bin, readyTimeoutMs: 5_000, logger, env, signal, onSpawn }),
  });
  sessions.push(session);
  return { reader: new WorldMachineGraphReader(session), session, record };
}

describe('WorldMachineGraphReader.listDevices', () => {
  it('lists devices from World Machine', async () => {
    const devices = await reader().reader.listDevices();
    expect(devices).toHaveLength(17);
    expect(devices[0]).toEqual({ id: 1, name: 'Height Output', enabled: true, bypassed: false });
  });

  it('lists devices when a log line interrupts the output', async () => {
    expect(await reader({ FAKE_WM_INTERLEAVE: '1' }).reader.listDevices()).toHaveLength(17);
  });

  it('passes the filter as the final argument', async () => {
    const { reader: r, record } = reader();
    await r.listDevices('Height Output');
    expect(record.lines()).toContain('device list Height Output');
  });

  it('refuses a filter containing a newline before anything is sent', async () => {
    const { reader: r, record } = reader();
    await expect(r.listDevices('x\nproject close force')).rejects.toMatchObject({ code: 'REFUSED' });
    expect(record.lines()).toEqual([]);
  });
});

describe('WorldMachineGraphReader device, scene, and project reads', () => {
  it('reads a device by #id', async () => {
    const { reader: r, record } = reader();
    const device = await r.getDevice('#35');
    expect(device).toMatchObject({
      id: 35,
      name: 'Erosion',
      type: 'Erosion',
      enabled: true,
      bypassed: false,
    });
    expect(device.parameters).toHaveLength(20);
    expect(device.inputs[0]).toEqual({
      port: 1,
      name: 'Primary Input',
      source: { device: 'Flow Restructure', port: 1 },
    });
    expect(device.outputs).toHaveLength(5);
    expect(record.lines()).toEqual(
      expect.arrayContaining([
        'device select #35',
        'device info',
        'param list #35',
        'wire list #35',
        'device list',
      ]),
    );
  });

  it('reads a device by name', async () => {
    expect((await reader().reader.getDevice('Erosion')).id).toBe(35);
  });

  it('reads a disabled device by name when device list marks it [disabled]', async () => {
    const infoOutput = [
      'Selected device:',
      '  Name:    Gradient',
      '  Type:    Gradient',
      '  Enabled: no',
      '  Bypass:  no',
    ];
    const frame = (command: string, output: string[]) => ({ command, output, errors: [] });
    const session = {
      assertAcceptingCalls: () => undefined,
      execute: async () => [
        frame('device select "Gradient"', []),
        frame('device info', infoOutput),
        frame('param list "Gradient"', lines('param-list-erosion.txt')),
        frame('wire list "Gradient"', lines('wire-list-erosion.txt')),
        frame('device list', [
          'Devices (2 total):',
          '  #1     Gradient                 [disabled]',
          '  #2     Combiner                ',
        ]),
      ],
    } as unknown as WorldMachineSession;
    const device = await new WorldMachineGraphReader(session).getDevice('Gradient');
    expect(device).toMatchObject({ id: 1, name: 'Gradient', enabled: false });
  });

  it('reports a missing device', async () => {
    await expect(reader().reader.getDevice('Nope')).rejects.toMatchObject({
      code: 'WM_COMMAND_FAILED',
      worldMachineMessage: "Error: Error: Device not found: 'Nope'",
    });
  });

  it('refuses a device reference containing a quote before anything is sent', async () => {
    const { reader: r, record } = reader();
    await expect(r.getDevice('A"B')).rejects.toMatchObject({ code: 'REFUSED' });
    expect(record.lines()).toEqual([]);
  });

  it('reads the current scene', async () => {
    expect(await reader().reader.getScene()).toMatchObject({
      name: 'Main Extents',
      resolution: 2049,
      locked: false,
    });
  });

  it('inspects the project in one batch', async () => {
    const overview = await reader().reader.inspectProject();
    expect(overview.scene.name).toBe('Main Extents');
    expect(overview.scenes).toHaveLength(1);
    expect(overview.devices).toHaveLength(17);
    expect(overview.deviceCount).toBe(17);
    expect(overview.groups).toHaveLength(5);
  });

  it('refuses get_device with SHUTTING_DOWN during shutdown, before checking the reference', async () => {
    const { reader: r, session, record } = reader();
    await session.shutdown();
    await expect(r.getDevice('A"B')).rejects.toMatchObject({ code: 'SHUTTING_DOWN' });
    expect(record.lines()).toEqual([]);
  });
});
