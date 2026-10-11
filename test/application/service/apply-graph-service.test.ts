import { describe, expect, it } from 'vitest';
import { ApplyGraphService } from '../../../src/application/service/apply-graph-service.js';
import type { WorldMachineError } from '../../../src/domain/errors.js';
import { planId } from '../../../src/domain/graph-plan.js';
import { type RawGraphSpec, validateGraphSpec } from '../../../src/domain/graph-spec.js';
import type { SessionSummary } from '../../../src/domain/session.js';

const SPEC: RawGraphSpec = {
  version: 1,
  devices: [
    { name: 'Ramp', type: 'Gradient' },
    { name: 'Hills', type: 'Perlin' },
  ],
};

describe('ApplyGraphService with a World Machine that exits between steps', () => {
  it('stops at the next step, reports CRASHED, and never restores', async () => {
    let summary: SessionSummary = { state: 'ready', binding: { kind: 'fresh' }, dirty: false };
    const calls: string[] = [];
    const session = {
      status: () => ({ executable: null, session: summary }),
      exclusive: <T>(action: () => Promise<T>) => action(),
    };
    const graph = { listDevices: async () => [], getDevice: async () => ({}) };
    const snapshots = {
      list: async () => [],
      create: async (name: string) => {
        calls.push(`create ${name}`);
        return { index: 0, name };
      },
      restore: async (name: string) => {
        calls.push(`restore ${name}`);
        return { index: 0, name };
      },
      remove: async (name: string) => {
        calls.push(`remove ${name}`);
        return {};
      },
    };
    const devices = {
      addDevice: async () => {
        calls.push('add');
        summary = { state: 'unhealthy', reason: 'x' };
        return { id: 536, name: 'Ramp', enabled: true };
      },
    };
    const stub = <T>(value: unknown): T => value as T;
    const service = new ApplyGraphService(
      stub<ConstructorParameters<typeof ApplyGraphService>[0]>(session),
      stub<ConstructorParameters<typeof ApplyGraphService>[1]>(graph),
      stub<ConstructorParameters<typeof ApplyGraphService>[2]>(devices),
      stub<ConstructorParameters<typeof ApplyGraphService>[3]>({}),
      stub<ConstructorParameters<typeof ApplyGraphService>[4]>({}),
      stub<ConstructorParameters<typeof ApplyGraphService>[5]>(snapshots),
    );
    const id = planId(validateGraphSpec(SPEC), { projectPath: null, devices: [], details: [] });
    const error = await service.applyGraph({ spec: SPEC, planId: id, keepSnapshot: false }).then(
      () => {
        throw new Error('the call succeeded');
      },
      (caught: unknown) => caught as WorldMachineError,
    );
    expect(error.code).toBe('APPLY_FAILED');
    expect(error.details).toMatchObject({
      failedStep: { index: 1, code: 'CRASHED' },
      completedSteps: 1,
      rolledBack: false,
    });
    expect(calls.filter((call) => call.startsWith('restore'))).toEqual([]);
    expect(calls.filter((call) => call === 'add')).toHaveLength(1);
  });
});
