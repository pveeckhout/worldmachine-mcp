import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { FsPathPolicy } from '../../src/adapter/out/fs/path-policy.js';
import { resolveExecutable } from '../../src/adapter/out/worldmachine/locator.js';
import { WorldMachineDeviceEditor } from '../../src/adapter/out/worldmachine/world-machine-device-editor.js';
import { WorldMachineGraphReader } from '../../src/adapter/out/worldmachine/world-machine-graph-reader.js';
import { WorldMachineParameterEditor } from '../../src/adapter/out/worldmachine/world-machine-parameter-editor.js';
import { WorldMachineProcess } from '../../src/adapter/out/worldmachine/world-machine-process.js';
import { WorldMachineProjectWriter } from '../../src/adapter/out/worldmachine/world-machine-project-writer.js';
import { WorldMachineSceneEditor } from '../../src/adapter/out/worldmachine/world-machine-scene-editor.js';
import { WorldMachineSession } from '../../src/adapter/out/worldmachine/world-machine-session.js';
import { WorldMachineWireEditor } from '../../src/adapter/out/worldmachine/world-machine-wire-editor.js';
import { captureLogger } from '../support/fake-wm.js';

const executable = resolveExecutable(process.env.WORLD_MACHINE_BIN ?? null);
const LIVE = process.env.WM_LIVE === '1' && executable !== null;

describe.skipIf(!LIVE)('live World Machine graph edits', () => {
  const logger = captureLogger();
  // describe.skipIf still runs this body at collection, so only create the directory when the run is live.
  const liveRoot = LIVE ? mkdtempSync(join(tmpdir(), 'wm-live-edits-')) : '';
  const session = new WorldMachineSession({
    executable,
    defaultProject: undefined,
    pathPolicy: new FsPathPolicy([liveRoot]),
    commandTimeoutMs: 30_000,
    idleTimeoutMs: 0,
    logger,
    startProcess: (bin, signal, onSpawn) =>
      WorldMachineProcess.start({ bin, readyTimeoutMs: 120_000, logger, signal, onSpawn }),
  });
  const reader = new WorldMachineGraphReader(session);
  const writer = new WorldMachineProjectWriter(session);
  const devices = new WorldMachineDeviceEditor(session);
  const parameters = new WorldMachineParameterEditor(session);
  const wires = new WorldMachineWireEditor(session);
  const scene = new WorldMachineSceneEditor(session);
  // Close-then-quit always runs, so the licence seat returns (spec fact 20). Nothing here quits inside a test.
  afterAll(async () => {
    try {
      await session.shutdown();
    } finally {
      rmSync(liveRoot, { recursive: true, force: true });
    }
  }, 30_000);

  // Devices are addressed as `#<id>` throughout: the default project's own names may repeat the ones added here.
  let grad = 0;
  let gradB = 0;
  let combiner = 0;
  let fileOutput = 0;

  it('creates the default project', async () => {
    await session.ensureRunning();
    await writer.createProject();
    expect(session.status().session.state).toBe('ready');
  }, 180_000);

  it('adds devices by type and by name, and rejects an unknown type', async () => {
    const first = await devices.addDevice('Gradient');
    const second = await devices.addDevice('Combiner');
    const third = await devices.addDevice('File Output');
    const named = await devices.addDevice('Gradient', 'Live Grad');
    expect(new Set([first.id, second.id, third.id, named.id]).size).toBe(4);
    grad = first.id;
    combiner = second.id;
    fileOutput = third.id;
    gradB = named.id;
    expect(named.name).toBe('Live Grad');
    const listed = await reader.listDevices();
    for (const added of [first, second, third, named]) {
      expect(listed.find((device) => device.id === added.id)?.name).toBe(added.name);
    }
    await expect(devices.addDevice('NoSuchDeviceType')).rejects.toMatchObject({
      code: 'WM_COMMAND_FAILED',
    });
    expect(await reader.listDevices()).toHaveLength(listed.length);
  }, 120_000);

  it('lists the eleven captured options of a Combiner Method (enum-options design section 6)', async () => {
    const device = await reader.getDevice(`#${combiner}`);
    // raw/enum-options.txt l.1558 and l.1572-1632.
    expect(device.parameters.find((p) => p.name === 'Method')).toEqual({
      name: 'Method',
      type: 'enum',
      value: 'Average',
      options: [
        'Average',
        'Add',
        'Subtract',
        'Multiply',
        'Max',
        'Min',
        'Power',
        'Root',
        'Detail',
        'Differences',
        'Screen',
      ],
    });
    expect(device).not.toHaveProperty('enumOptionsNote');
  }, 60_000);

  it("lists no options for the default project's Flow Restructure, an older device version (enum-options design section 6)", async () => {
    // raw/default-updated.txt l.463-470 (`fillquality`) against raw/enum-options.txt l.3152-3156 (`Operation`).
    const device = await reader.getDevice('Flow Restructure');
    expect(device.parameters.some((p) => p.type === 'enum')).toBe(true);
    expect(device.parameters.filter((p) => p.options !== undefined)).toEqual([]);
    expect(device.enumOptionsNote).toContain(
      "enum options omitted: this 'Flow Restructure' has other parameters than a new 'Flow Restructure' (another device version)",
    );
  }, 60_000);

  it('renames to 23 characters and refuses 24 without sending', async () => {
    const name23 = 'ABCDEFGHIJKLMNOPQRSTUVW';
    const renamed = await devices.renameDevice(`#${grad}`, name23);
    expect(renamed.device.name).toBe(name23);
    expect((await reader.listDevices()).find((device) => device.id === grad)?.name).toBe(name23);
    await expect(devices.renameDevice(`#${grad}`, `${name23}X`)).rejects.toMatchObject({
      code: 'REFUSED',
    });
    expect((await reader.listDevices()).find((device) => device.id === grad)?.name).toBe(name23);
    await devices.renameDevice(`#${grad}`, 'Grad A');
  }, 120_000);

  it('disables and enables a device, reporting whether the state changed', async () => {
    const off = await devices.setDeviceEnabled(`#${grad}`, false);
    expect(off).toMatchObject({ enabled: false, changed: true });
    expect((await reader.listDevices()).find((device) => device.id === grad)?.enabled).toBe(false);
    expect(await devices.setDeviceEnabled(`#${grad}`, false)).toMatchObject({
      enabled: false,
      changed: false,
    });
    expect(await devices.setDeviceEnabled(`#${grad}`, true)).toMatchObject({
      enabled: true,
      changed: true,
    });
    expect(await devices.setDeviceEnabled(`#${grad}`, true)).toMatchObject({
      enabled: true,
      changed: false,
    });
  }, 120_000);

  it('sets and removes bypass, never toggling a device already in that state, also on a disabled device', async () => {
    const ref = `#${gradB}`;
    expect(await devices.setDeviceBypassed(ref, true)).toMatchObject({ bypassed: true, changed: true });
    expect((await reader.getDevice(ref)).bypassed).toBe(true);
    // `device bypass` toggles: a second request for the same state must send nothing and leave it bypassed.
    expect(await devices.setDeviceBypassed(ref, true)).toMatchObject({ bypassed: true, changed: false });
    expect((await reader.getDevice(ref)).bypassed).toBe(true);
    // Fact 29: `device list` hides bypass on a disabled device; `device info` still reports it.
    await devices.setDeviceEnabled(ref, false);
    expect(await devices.setDeviceBypassed(ref, false)).toMatchObject({ bypassed: false, changed: true });
    expect(await devices.setDeviceBypassed(ref, true)).toMatchObject({ bypassed: true, changed: true });
    expect(await reader.getDevice(ref)).toMatchObject({ enabled: false, bypassed: true });
    await devices.setDeviceBypassed(ref, false);
    await devices.setDeviceEnabled(ref, true);
    expect(await reader.getDevice(ref)).toMatchObject({ enabled: true, bypassed: false });
  }, 120_000);

  it('sets a float and an enum, rejects an out-of-range enum per item, refuses a filename', async () => {
    const update = await parameters.updateParameters(`#${grad}`, { Direction: -1, Tiling: 1 });
    expect(update.device.id).toBe(grad);
    const direction = update.parameters.find((item) => item.name === 'Direction');
    const tiling = update.parameters.find((item) => item.name === 'Tiling');
    expect(direction).toMatchObject({ outcome: 'applied', value: '-1' });
    expect(tiling?.outcome).toBe('applied');
    const afterTiling = (await reader.getDevice(`#${grad}`)).parameters.find((p) => p.name === 'Tiling');
    expect(afterTiling?.value).toBe(tiling?.value);

    const bad = await parameters.updateParameters(`#${grad}`, { Tiling: 99 });
    const rejected = bad.parameters[0];
    expect(rejected?.outcome).toBe('rejected');
    expect(rejected?.worldMachineMessage).toMatch(/out of range/);
    expect(rejected?.value).toBe(tiling?.value);

    const before = (await reader.getDevice(`#${fileOutput}`)).parameters.find((p) => p.name === 'filename');
    expect(before?.type).toBe('filename');
    await expect(parameters.updateParameters(`#${fileOutput}`, { filename: 'x.png' })).rejects.toMatchObject({
      code: 'REFUSED',
    });
    const after = (await reader.getDevice(`#${fileOutput}`)).parameters.find((p) => p.name === 'filename');
    expect(after?.value).toBe(before?.value);
  }, 120_000);

  it('reads and sets parameters whose names have spaces (raw/river-device.txt)', async () => {
    const river = await devices.addDevice('River');
    const read = await reader.getDevice(`#${river.id}`);
    expect(read.parameters).toHaveLength(25);
    // raw/enum-options.txt l.6160-6166: the catalog's two options.
    expect(read.parameters.find((p) => p.name === 'Planform Type')).toEqual({
      name: 'Planform Type',
      type: 'enum',
      value: 'Simple Alignment',
      options: ['Simple Alignment', 'Layout Alignment'],
    });
    const update = await parameters.updateParameters(`#${river.id}`, {
      'Planform Type': 1,
      'Layout Alignment Uses Datum': true,
      'Bankfull Width': 0.5,
    });
    expect(update.parameters.map((item) => [item.name, item.outcome])).toEqual([
      ['Planform Type', 'applied'],
      ['Layout Alignment Uses Datum', 'applied'],
      ['Bankfull Width', 'applied'],
    ]);
    expect(update.parameters[0]?.value).toBe('Layout Alignment');
    expect(update.parameters[1]?.value).toBe('true');
    const after = (await reader.getDevice(`#${river.id}`)).parameters;
    for (const item of update.parameters) {
      expect(after.find((p) => p.name === item.name)?.value).toBe(item.value);
    }
  }, 120_000);

  it('sets lengths in m through the scale probe, and one undo per parameter restores each (float-units section 6)', async () => {
    const constant = await devices.addDevice('Constant');
    const readValue = async (id: number, name: string) =>
      (await reader.getDevice(`#${id}`)).parameters.find((p) => p.name === name)?.value;
    const widthBefore = await readValue(grad, 'Width');
    const heightBefore = await readValue(constant.id, 'Height');
    // raw/float-scale-default.txt l.60-73 and l.101-114 (facts 87 and 89): 8 km and 2625 m per unit.
    const width = await parameters.updateParameters(`#${grad}`, { Width: '500 m' });
    expect(width.parameters).toEqual([
      {
        name: 'Width',
        type: 'float',
        requested: '0.0625',
        outcome: 'applied',
        value: '500 m',
        given: '500 m',
        scale: '8 km',
      },
    ]);
    const height = await parameters.updateParameters(`#${constant.id}`, { Height: '656.25 m' });
    expect(height.parameters).toEqual([
      {
        name: 'Height',
        type: 'float',
        requested: '0.25',
        outcome: 'applied',
        value: '656.2 m',
        given: '656.25 m',
        scale: '2625 m',
      },
    ]);
    // Float-units spec section 4 ("to be confirmed by the live test"): the redo entry a probe's undo leaves is
    // cleared by the next `param set`, so a redo after the sets changes nothing. A rejected redo (nothing to redo)
    // also changes nothing, so its error is not the assertion; the values are.
    await writer.redo().catch(() => undefined);
    expect(await readValue(constant.id, 'Height')).toBe('656.2 m');
    expect(await readValue(grad, 'Width')).toBe('500 m');
    // Fact 90: the probes left no undo step, so each undo reverts one call's set, the last first.
    await writer.undo();
    expect(await readValue(constant.id, 'Height')).toBe(heightBefore);
    expect(await readValue(grad, 'Width')).toBe('500 m');
    await writer.undo();
    expect(await readValue(grad, 'Width')).toBe(widthBefore);
  }, 120_000);

  it('connects and disconnects idempotently, and rejects a wire onto an occupied input', async () => {
    const first = await wires.connect({ device: `#${grad}` }, { device: `#${combiner}` });
    expect(first.created).toBe(true);
    expect(first.destination).toMatchObject({ id: combiner, port: 1 });
    expect((await wires.connect({ device: `#${grad}` }, { device: `#${combiner}` })).created).toBe(false);

    const occupied = wires.connect({ device: `#${gradB}` }, { device: `#${combiner}` });
    await expect(occupied).rejects.toMatchObject({ code: 'WM_COMMAND_FAILED' });
    await expect(occupied).rejects.toMatchObject({
      worldMachineMessage: expect.stringContaining('already connected'),
    });

    const second = await wires.connect({ device: `#${gradB}` }, { device: `#${combiner}`, port: 2 });
    expect(second).toMatchObject({ created: true, destination: { port: 2 } });
    expect(
      (await wires.disconnect({ device: `#${gradB}` }, { device: `#${combiner}`, port: 2 })).removed,
    ).toBe(true);
    expect(
      (await wires.disconnect({ device: `#${gradB}` }, { device: `#${combiner}`, port: 2 })).removed,
    ).toBe(false);
    expect((await wires.disconnect({ device: `#${grad}` }, { device: `#${combiner}` })).removed).toBe(true);
    expect((await wires.disconnect({ device: `#${grad}` }, { device: `#${combiner}` })).removed).toBe(false);
  }, 120_000);

  it('configures the scene name, origin, size, and resolution', async () => {
    const result = await scene.configureScene({
      name: 'Live Scene',
      originKm: { x: 1.5, y: -2 },
      sizeKm: { width: 8, height: 4 },
      resolution: 1025,
    });
    expect(result.name).toBe('Live Scene');
    expect(result.originKm).toEqual({ x: 1.5, y: -2 });
    expect(result.sizeKm).toEqual({ width: 8, height: 4 });
    expect(result.resolution).toBe(1025);
    expect(await reader.getScene()).toEqual(result);
  }, 120_000);

  it('deletes a device', async () => {
    const deleted = await devices.deleteDevice(`#${gradB}`);
    expect(deleted.id).toBe(gradB);
    expect((await reader.listDevices()).some((device) => device.id === gradB)).toBe(false);
    // The session is left to afterAll, which closes the project and quits.
  }, 120_000);
});
