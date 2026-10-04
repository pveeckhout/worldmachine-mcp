import { describe, expect, it } from 'vitest';
import type {
  SessionStatus,
  WorldMachineSessionPort,
} from '../../../src/application/port/out/world-machine-session-port.js';
import { GetStatusService } from '../../../src/application/service/get-status-service.js';

function sessionWith(status: SessionStatus): WorldMachineSessionPort & { started: number } {
  return {
    started: 0,
    async ensureRunning() {
      this.started++;
    },
    status: () => status,
    async shutdown() {},
  };
}

describe('GetStatusService', () => {
  it('reports an unconfigured server without starting World Machine', async () => {
    const session = sessionWith({ executable: null, session: { state: 'notRunning' } });
    expect(await new GetStatusService(session).getStatus({})).toEqual({
      configured: false,
      executable: null,
      session: { state: 'notRunning' },
    });
    expect(session.started).toBe(0);
  });

  it('includes build details once World Machine has reported them', async () => {
    const session = sessionWith({
      executable: '/opt/wm',
      session: { state: 'ready', binding: { kind: 'fresh' }, dirty: false },
      systemInfo: { build: 4067, buildName: 'Dragontail Peak', arch: 'x64' },
    });
    expect(await new GetStatusService(session).getStatus({})).toEqual({
      configured: true,
      executable: '/opt/wm',
      build: 4067,
      buildName: 'Dragontail Peak',
      session: { state: 'ready', binding: { kind: 'fresh' }, dirty: false },
    });
  });
});
