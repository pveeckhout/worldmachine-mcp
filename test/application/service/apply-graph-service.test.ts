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
    readonly restoreError?: Error;
    /** Called after the nth add resolved; lets a test bump the generation (a silent restart). */
    readonly afterAdd?: (count: number) => void;
    /** Called inside each diff read, before it returns; lets a test bump the generation during the read. */
    readonly onDiffRead?: () => void;
  }) => {
    const calls: string[] = [];
    const control = { generation: 1 };
    let adds = 0;
    const session = {
      status: () => ({
        executable: null,
        session: { state: 'ready', binding: { kind: 'fresh' }, dirty: false } as SessionSummary,
        generation: control.generation,
      }),
      exclusive: <T>(action: () => Promise<T>) => action(),
    };
    const graph = {
      listDevices: async () => [],
      getDevice: async () => {
        options.onDiffRead?.();
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
        if (options.restoreError !== undefined) throw options.restoreError;
        return { index: 0, name };
      },
      remove: async (name: string) => {
        calls.push(`remove ${name}`);
        return {};
      },
    };
    const devices = {
      addDevice: async (type: string) => {
        adds += 1;
        const row =
          options.addDevice === undefined
            ? { id: 535 + adds, name: adds === 1 ? 'Ramp' : 'Hills', kind: type, enabled: true }
            : await options.addDevice(type, adds);
        options.afterAdd?.(adds);
        return row;
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
    return { service, calls, id, control };
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
      session: { state: 'ready' },
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

  it('treats a silent restart after the last step as World Machine lost', async () => {
    const { service, calls, id } = ((): ReturnType<typeof build> => {
      const built: { control?: { generation: number } } = {};
      const result = build({
        diffError: new WorldMachineError('WM_COMMAND_FAILED', 'read failed'),
        afterAdd: (count) => {
          if (count === 2 && built.control) built.control.generation += 1;
        },
      });
      built.control = result.control;
      return result;
    })();
    const error = (await failure(
      service.applyGraph({ spec: SPEC, planId: id, keepSnapshot: false }),
    )) as WorldMachineError;
    expect(error).toBeInstanceOf(WorldMachineError);
    expect(error.code).toBe('CRASHED');
    expect(error.message).toContain('were applied');
    expect(error.message).toContain('are gone with it');
    expect(calls.filter((call) => call.startsWith('remove'))).toEqual([]);
  });

  it('catches a generation change between steps as CRASHED and restores nothing', async () => {
    const built: { control?: { generation: number } } = {};
    const result = build({
      afterAdd: (count) => {
        if (count === 1 && built.control) built.control.generation += 1;
      },
    });
    built.control = result.control;
    const error = (await failure(
      result.service.applyGraph({ spec: SPEC, planId: result.id, keepSnapshot: false }),
    )) as WorldMachineError;
    expect(error.code).toBe('APPLY_FAILED');
    expect(error.details).toMatchObject({ failedStep: { index: 1, code: 'CRASHED' }, rolledBack: false });
    expect(result.calls.filter((call) => call.startsWith('restore'))).toEqual([]);
  });

  it('rethrows a TIMEOUT from the diff read with the lost message', async () => {
    const { service, id } = build({ diffError: new WorldMachineError('TIMEOUT', 'too slow') });
    const error = (await failure(
      service.applyGraph({ spec: SPEC, planId: id, keepSnapshot: false }),
    )) as WorldMachineError;
    expect(error.code).toBe('TIMEOUT');
    expect(error.message).toContain('were applied');
  });

  it('keeps the original error in the message when the restore itself throws', async () => {
    const { service, id } = build({
      restoreError: new TypeError('restore blew up'),
      addDevice: async (type, count) => {
        if (count === 2) throw new TypeError('boom');
        return { id: 536, name: 'Ramp', kind: type, enabled: true };
      },
    });
    const error = await failure(service.applyGraph({ spec: SPEC, planId: id, keepSnapshot: false }));
    expect(error).not.toBeInstanceOf(WorldMachineError);
    const message = (error as Error).message;
    expect(message).toContain('could not be confirmed');
    expect(message).toContain('boom');
    expect(message).toContain('restore blew up');
    expect((error as Error).cause).toBeInstanceOf(TypeError);
  });

  it('does not restore after an internal error when the session was lost', async () => {
    const built: { control?: { generation: number } } = {};
    const result = build({
      addDevice: async (type, count) => {
        if (count === 2) {
          if (built.control) built.control.generation += 1;
          throw new TypeError('boom');
        }
        return { id: 536, name: 'Ramp', kind: type, enabled: true };
      },
    });
    built.control = result.control;
    const error = await failure(
      result.service.applyGraph({ spec: SPEC, planId: result.id, keepSnapshot: false }),
    );
    expect((error as Error).message).toContain('nothing was restored');
    expect(result.calls.filter((call) => call.startsWith('restore'))).toEqual([]);
  });

  it('rejects CRASHED when the generation changed after the last step and the diff read succeeds', async () => {
    const built: { control?: { generation: number } } = {};
    const result = build({
      afterAdd: (count) => {
        if (count === 2 && built.control) built.control.generation += 1;
      },
    });
    built.control = result.control;
    const error = (await failure(
      result.service.applyGraph({ spec: SPEC, planId: result.id, keepSnapshot: false }),
    )) as WorldMachineError;
    expect(error.code).toBe('CRASHED');
    expect(error.message).toContain('were applied');
    expect(result.calls.filter((call) => call.startsWith('remove'))).toEqual([]);
  });

  it('rejects CRASHED when the generation changes during the diff read', async () => {
    const built: { control?: { generation: number } } = {};
    const result = build({
      onDiffRead: () => {
        if (built.control) built.control.generation += 1;
      },
    });
    built.control = result.control;
    const error = (await failure(
      result.service.applyGraph({ spec: SPEC, planId: result.id, keepSnapshot: false }),
    )) as WorldMachineError;
    expect(error.code).toBe('CRASHED');
    expect(error.message).toContain('were applied');
    expect(result.calls.filter((call) => call.startsWith('remove'))).toEqual([]);
  });
});
