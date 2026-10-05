import { describe, expect, it } from 'vitest';
import type { ProjectGraphReadPort } from '../../../src/application/port/out/project-graph-read-port.js';
import type { WorldMachineSessionPort } from '../../../src/application/port/out/world-machine-session-port.js';
import { GetDeviceService } from '../../../src/application/service/get-device-service.js';
import { GetSceneService } from '../../../src/application/service/get-scene-service.js';
import { InspectProjectService } from '../../../src/application/service/inspect-project-service.js';
import type { DeviceDetail } from '../../../src/domain/device.js';
import type { Scene } from '../../../src/domain/scene.js';

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
};

const session: WorldMachineSessionPort = {
  ensureRunning: async () => {},
  status: () => ({ executable: '/wm', session: READY }),
  shutdown: async () => {},
  forgetReopen: () => {},
  exclusive: (action) => action(),
};
const graph: ProjectGraphReadPort = {
  listDevices: async () => [],
  getDevice: async (ref) => ({ ...device, name: ref }),
  getScene: async () => scene,
  inspectProject: async () => ({ scene, scenes: [], deviceCount: 0, devices: [], groups: [] }),
};

describe('read services', () => {
  it('return the read result with the session state', async () => {
    expect(await new GetDeviceService(session, graph).getDevice({ device: '#1' })).toEqual({
      device: { ...device, name: '#1' },
      session: READY,
    });
    expect(await new GetSceneService(session, graph).getScene({})).toEqual({ scene, session: READY });
    expect(await new InspectProjectService(session, graph).inspectProject({})).toEqual({
      project: { scene, scenes: [], deviceCount: 0, devices: [], groups: [] },
      session: READY,
    });
  });
});
