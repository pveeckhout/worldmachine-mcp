import { describe, expect, it } from 'vitest';
import {
  PORT_TYPE_CATALOGS,
  WorldMachinePortTypes,
} from '../../../src/adapter/out/worldmachine/world-machine-port-types.js';
import type { ProjectGraphReadPort } from '../../../src/application/port/out/project-graph-read-port.js';
import type { WorldMachineSessionPort } from '../../../src/application/port/out/world-machine-session-port.js';
import { GetDeviceService } from '../../../src/application/service/get-device-service.js';
import { GetSceneService } from '../../../src/application/service/get-scene-service.js';
import { InspectProjectService } from '../../../src/application/service/inspect-project-service.js';
import type { DeviceDetail } from '../../../src/domain/device.js';
import type { Scene } from '../../../src/domain/scene.js';
import { statusOn } from '../../support/port-types.js';

const READY = { state: 'ready', binding: { kind: 'fresh' }, dirty: false } as const;
const scene: Scene = {
  name: 'S',
  index: 0,
  count: 1,
  originKm: { x: 0, y: 0 },
  sizeKm: { width: 8, height: 8 },
  resolution: 1024,
  locked: false,
};
const device: DeviceDetail = {
  id: 1,
  name: 'G',
  type: 'Gradient',
  enabled: true,
  bypassed: false,
  parameters: [],
  inputs: [],
  outputs: [],
  portTypes: 'unknown',
};

const session: WorldMachineSessionPort = {
  ensureRunning: async () => {},
  status: () => ({ executable: '/wm', session: READY }),
  shutdown: async () => {},
  forgetReopen: () => {},
  projectRevision: () => 0,
  projectSwitches: () => 0,
  exclusive: (action) => action(),
};
const graph: ProjectGraphReadPort = {
  listDevices: async () => [],
  getDevice: async (ref) => ({ ...device, name: ref }),
  getScene: async () => scene,
  inspectProject: async () => ({ scene, scenes: [], deviceCount: 0, devices: [], groups: [] }),
};

const noCatalog = new WorldMachinePortTypes(statusOn(undefined), []);
const sessionAt = (build: number): WorldMachineSessionPort => ({
  ...session,
  status: () => ({ ...statusOn(build).status() }),
});

describe('get_device catalog info', () => {
  it('names the catalog a device was typed with', async () => {
    const at4069 = sessionAt(4069);
    const view = await new GetDeviceService(
      at4069,
      graph,
      new WorldMachinePortTypes(at4069, PORT_TYPE_CATALOGS),
    ).getDevice({
      device: '#1',
    });
    expect(view.catalog).toStrictEqual({ build: 4069, portTypes: 'shipped', corrections: false });
  });

  it('carries the startup problems on a build without a catalog', async () => {
    const at4071 = sessionAt(4071);
    const types = new WorldMachinePortTypes(at4071, PORT_TYPE_CATALOGS, [
      '/c/4071/port-types.json: not JSON',
    ]);
    expect(
      (await new GetDeviceService(at4071, graph, types).getDevice({ device: '#1' })).catalog,
    ).toStrictEqual({
      build: 4071,
      portTypes: 'none',
      corrections: false,
      problems: ['/c/4071/port-types.json: not JSON'],
    });
  });
});

describe('get_device capture offer', () => {
  it('offers a capture with the injected minutes on an uncatalogued build', async () => {
    const at4071 = sessionAt(4071);
    const view = await new GetDeviceService(
      at4071,
      graph,
      new WorldMachinePortTypes(at4071, PORT_TYPE_CATALOGS),
      { short: 11, full: 285 },
    ).getDevice({ device: '#1' });
    expect(view.catalog.capture).toMatch(
      /^No catalog for build 4071\. capture_catalog .*about 11 min.*about 285 min/,
    );
  });

  it('recommends a full capture when the build has enum options but no port types', async () => {
    const at4071 = sessionAt(4071);
    const view = await new GetDeviceService(
      at4071,
      graph,
      new WorldMachinePortTypes(at4071, PORT_TYPE_CATALOGS),
      { short: 11, full: 285 },
      { portTypeCatalogs: () => PORT_TYPE_CATALOGS, enumCatalogs: () => [{ build: 4071, types: {} }] },
    ).getDevice({ device: '#1' });
    expect(view.catalog.capture).toMatch(/^No port types for build 4071; .*mode full .*about 285 min/);
  });
});

describe('read services', () => {
  it('return the read result with the session state', async () => {
    expect(await new GetDeviceService(session, graph, noCatalog).getDevice({ device: '#1' })).toEqual({
      device: { ...device, name: '#1' },
      session: READY,
      catalog: { build: null, portTypes: 'none', corrections: false },
    });
    expect(await new GetSceneService(session, graph).getScene({})).toEqual({ scene, session: READY });
    expect(await new InspectProjectService(session, graph).inspectProject({})).toEqual({
      project: { scene, scenes: [], deviceCount: 0, devices: [], groups: [] },
      session: READY,
    });
  });
});
