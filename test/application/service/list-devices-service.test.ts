import { describe, expect, it } from 'vitest';
import type { ProjectGraphReadPort } from '../../../src/application/port/out/project-graph-read-port.js';
import type { WorldMachineSessionPort } from '../../../src/application/port/out/world-machine-session-port.js';
import { ListDevicesService } from '../../../src/application/service/list-devices-service.js';
import { WorldMachineError } from '../../../src/domain/errors.js';

describe('ListDevicesService', () => {
  it('lists devices with the session state after the call, leaving startup to the graph port', async () => {
    const calls: string[] = [];
    const session: WorldMachineSessionPort = {
      async ensureRunning() {
        calls.push('ensureRunning');
      },
      status: () => ({
        executable: '/opt/wm',
        session: { state: 'ready', binding: { kind: 'fresh' }, dirty: false },
      }),
      async shutdown() {},
      forgetReopen: () => {},
      exclusive: (action) => action(),
    };
    const graph: ProjectGraphReadPort = {
      async listDevices(filter) {
        calls.push(`listDevices:${filter}`);
        return [{ id: 1, name: 'Height Output', enabled: true, bypassed: false }];
      },
      getDevice: async () => {
        throw new Error('unused');
      },
      getScene: async () => {
        throw new Error('unused');
      },
      inspectProject: async () => {
        throw new Error('unused');
      },
    };
    expect(await new ListDevicesService(session, graph).listDevices({ filter: 'Height' })).toEqual({
      devices: [{ id: 1, name: 'Height Output', enabled: true, bypassed: false }],
      session: { state: 'ready', binding: { kind: 'fresh' }, dirty: false },
    });
    expect(calls).toEqual(['listDevices:Height']);
  });

  it('propagates failures from the graph port', async () => {
    const session: WorldMachineSessionPort = {
      ensureRunning: async () => {},
      status: () => ({ executable: null, session: { state: 'notRunning' } }),
      async shutdown() {},
      forgetReopen: () => {},
      exclusive: (action) => action(),
    };
    const graph: ProjectGraphReadPort = {
      listDevices: () => Promise.reject(new WorldMachineError('NOT_CONFIGURED', 'no bin')),
      getDevice: async () => {
        throw new Error('unused');
      },
      getScene: async () => {
        throw new Error('unused');
      },
      inspectProject: async () => {
        throw new Error('unused');
      },
    };
    await expect(new ListDevicesService(session, graph).listDevices({})).rejects.toMatchObject({
      code: 'NOT_CONFIGURED',
    });
  });
});
