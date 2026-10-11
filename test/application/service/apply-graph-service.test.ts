import { describe, expect, it } from 'vitest';
import { ApplyGraphService } from '../../../src/application/service/apply-graph-service.js';
import { WorldMachineError } from '../../../src/domain/errors.js';
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
      // Listed as `Ramp (<type>)`: the spec name and the requested type, so neither a rename nor the type check runs.
      addDevice: async (type: string) => {
        calls.push('add');
        summary = { state: 'unhealthy', reason: 'x' };
        return { id: 536, name: 'Ramp', kind: type, enabled: true };
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

describe('ApplyGraphService robustness', () => {
  const stub = <T>(value: unknown): T => value as T;
  const build = (options: {
    readonly addDevice?: (type: string, count: number) => Promise<unknown>;
    readonly diffError?: Error;
  }) => {
    const calls: string[] = [];
    let adds = 0;
    const session = {
      status: () => ({
        executable: null,
        session: { state: 'ready', binding: { kind: 'fresh' }, dirty: false } as SessionSummary,
      }),
      exclusive: <T>(action: () => Promise<T>) => action(),
    };
    const graph = {
      listDevices: async () => [],
      getDevice: async () => {
        if (options.diffError !== undefined) throw options.diffError;
        return {};
      },
    };
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
      addDevice:
        options.addDevice === undefined
          ? async (type: string) => {
              adds += 1;
              return { id: 535 + adds, name: adds === 1 ? 'Ramp' : 'Hills', kind: type, enabled: true };
            }
          : async (type: string) => {
              adds += 1;
              return options.addDevice?.(type, adds);
            },
    };
    const service = new ApplyGraphService(
      stub<ConstructorParameters<typeof ApplyGraphService>[0]>(session),
      stub<ConstructorParameters<typeof ApplyGraphService>[1]>(graph),
      stub<ConstructorParameters<typeof ApplyGraphService>[2]>(devices),
      stub<ConstructorParameters<typeof ApplyGraphService>[3]>({}),
      stub<ConstructorParameters<typeof ApplyGraphService>[4]>({}),
      stub<ConstructorParameters<typeof ApplyGraphService>[5]>(snapshots),
    );
    const id = planId(validateGraphSpec(SPEC), { projectPath: null, devices: [], details: [] });
    return { service, calls, id };
  };
  const failure = (promise: Promise<unknown>): Promise<unknown> =>
    promise.then(
      () => {
        throw new Error('the call succeeded');
      },
      (caught: unknown) => caught,
    );

  it('reports an applied graph whose diff cannot be read, and keeps the snapshot', async () => {
    const { service, calls, id } = build({
      diffError: new WorldMachineError('WM_COMMAND_FAILED', 'read failed'),
    });
    const view = await service.applyGraph({ spec: SPEC, planId: id, keepSnapshot: false });
    expect(view).toMatchObject({
      applied: 2,
      snapshot: `apply_graph ${id.slice(0, 12)}`,
      diff: [],
      diffError: 'read failed',
    });
    expect(calls.filter((call) => call.startsWith('remove'))).toEqual([]);
  });

  it('throws the same code when the diff read finds World Machine crashed', async () => {
    const { service, calls, id } = build({ diffError: new WorldMachineError('CRASHED', 'gone') });
    const error = (await failure(
      service.applyGraph({ spec: SPEC, planId: id, keepSnapshot: false }),
    )) as WorldMachineError;
    expect(error).toBeInstanceOf(WorldMachineError);
    expect(error.code).toBe('CRASHED');
    expect(error.message).toContain('were applied');
    expect(error.message).toContain(`apply_graph ${id.slice(0, 12)}`);
    expect(calls.filter((call) => call.startsWith('remove'))).toEqual([]);
  });

  it('restores after a non-World-Machine error in a step and throws a plain Error', async () => {
    const { service, calls, id } = build({
      addDevice: async (type, count) => {
        if (count === 2) throw new TypeError('boom');
        return { id: 536, name: 'Ramp', kind: type, enabled: true };
      },
    });
    const error = await failure(service.applyGraph({ spec: SPEC, planId: id, keepSnapshot: false }));
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(WorldMachineError);
    const message = (error as Error).message;
    expect(message).toContain('internal error');
    expect(message).toContain(`apply_graph ${id.slice(0, 12)}`);
    expect(message).toContain('restored');
    expect(message).toContain('boom');
    expect(calls).toContain(`restore apply_graph ${id.slice(0, 12)}`);
  });
});
