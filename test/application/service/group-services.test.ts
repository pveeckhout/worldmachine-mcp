import { describe, expect, it } from 'vitest';
import type { GroupPort } from '../../../src/application/port/out/group-port.js';
import type { WorldMachineSessionPort } from '../../../src/application/port/out/world-machine-session-port.js';
import { ListGroupsService } from '../../../src/application/service/list-groups-service.js';
import { SetGroupEnabledService } from '../../../src/application/service/set-group-enabled-service.js';
import type { SessionSummary } from '../../../src/domain/session.js';

const READY_DIRTY: SessionSummary = { state: 'ready', binding: { kind: 'fresh' }, dirty: true };
const TERRAIN = { index: 0, name: 'Create your Terrain', deviceCount: 6 };

function fakes() {
  const calls: string[] = [];
  const session: WorldMachineSessionPort = {
    ensureRunning: async () => {},
    status: () => ({ executable: '/wm', session: READY_DIRTY }),
    shutdown: async () => {},
    forgetReopen: () => undefined,
    exclusive: (action) => {
      calls.push('exclusive:start');
      return action().finally(() => void calls.push('exclusive:end'));
    },
  };
  const groups: GroupPort = {
    list: async (filter) => {
      calls.push(`list:${filter}`);
      return [TERRAIN];
    },
    setEnabled: async (group, enabled) => {
      calls.push(`set:${group}:${enabled}`);
      return { ...TERRAIN, extra: 1 } as typeof TERRAIN;
    },
    resolve: async () => TERRAIN,
  };
  return { calls, session, groups };
}

describe('group services (spec v2b section 3)', () => {
  it('ListGroupsService lists outside exclusive and passes the filter on', async () => {
    const f = fakes();
    const service = new ListGroupsService(f.session, f.groups);
    expect(await service.listGroups({})).toEqual({ groups: [TERRAIN], session: READY_DIRTY });
    await service.listGroups({ filter: 'Terrain' });
    expect(f.calls).toEqual(['list:undefined', 'list:Terrain']);
  });

  it('SetGroupEnabledService sets the state inside exclusive and builds its view field by field', async () => {
    const f = fakes();
    expect(
      await new SetGroupEnabledService(f.session, f.groups).setGroupEnabled({ group: '#0', enabled: false }),
    ).toEqual({
      index: 0,
      name: 'Create your Terrain',
      deviceCount: 6,
      enabled: false,
      session: READY_DIRTY,
    });
    expect(f.calls).toEqual(['exclusive:start', 'set:#0:false', 'exclusive:end']);
  });
});
