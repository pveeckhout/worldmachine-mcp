import { describe, expect, it } from 'vitest';
import { ApplyGraphService } from '../../../src/application/service/apply-graph-service.js';
import { PlanGraphService } from '../../../src/application/service/plan-graph-service.js';
import type { DeviceDetail } from '../../../src/domain/device.js';
import { WorldMachineError } from '../../../src/domain/errors.js';
import { planId } from '../../../src/domain/graph-plan.js';
import { type RawGraphSpec, validateGraphSpec } from '../../../src/domain/graph-spec.js';
import type { SessionSummary } from '../../../src/domain/session.js';
import { syntheticPortTypes } from '../../support/port-types.js';

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
      stub<ConstructorParameters<typeof ApplyGraphService>[6]>({
        portsOf: () => undefined,
        portsOfAdded: () => undefined,
      }),
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
    /** Thrown by `snapshot delete`. */
    readonly removeError?: Error;
    /** The rows `device list` shows after a restore, so the read-back fingerprint differs from the plan's. */
    readonly listAfterRestore?: readonly { id: number; name: string; enabled: boolean }[];
    /** Called after the nth add resolved; lets a test bump the generation (a silent restart). */
    readonly afterAdd?: (count: number) => void;
    /** Called inside each diff read, before it returns; lets a test bump the generation during the read. */
    readonly onDiffRead?: () => void;
  }) => {
    const calls: string[] = [];
    const control = { generation: 1 };
    let adds = 0;
    let restored = false;
    const session = {
      status: () => ({
        executable: null,
        session: { state: 'ready', binding: { kind: 'fresh' }, dirty: false } as SessionSummary,
        generation: control.generation,
      }),
      exclusive: <T>(action: () => Promise<T>) => action(),
    };
    const graph = {
      listDevices: async () => (restored ? (options.listAfterRestore ?? []) : []),
      getDevice: async (reference: string) => {
        options.onDiffRead?.();
        if (options.diffError !== undefined) throw options.diffError;
        // A device with the requested id: graphDiff throws for a device it cannot find.
        return {
          id: Number(reference.slice(1)),
          name: 'Read',
          type: 'Read',
          enabled: true,
          bypassed: false,
          parameters: [],
          inputs: [],
          outputs: [],
          portTypes: 'unknown',
        };
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
        restored = true;
        return { index: 0, name };
      },
      remove: async (name: string) => {
        calls.push(`remove ${name}`);
        if (options.removeError !== undefined) throw options.removeError;
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
      stub<ConstructorParameters<typeof ApplyGraphService>[6]>({
        portsOf: () => undefined,
        portsOfAdded: () => undefined,
      }),
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

  it('reports an applied graph with its snapshot kept when the snapshot delete fails (D16)', async () => {
    const { service, calls, id } = build({
      removeError: new WorldMachineError('WM_COMMAND_FAILED', 'delete failed'),
    });
    const view = await service.applyGraph({ spec: SPEC, planId: id, keepSnapshot: false });
    expect(view).toMatchObject({ applied: 2, snapshot: `apply_graph ${id.slice(0, 12)}` });
    expect(view).not.toHaveProperty('diffError');
    expect(calls).toContain(`remove apply_graph ${id.slice(0, 12)}`);
  });

  it('reports rolledBack: false when the restore runs but the project does not match the plan (D14)', async () => {
    const { service, calls, id } = build({
      listAfterRestore: [{ id: 1, name: 'Stray', enabled: true }],
      addDevice: async (type, count) => {
        if (count === 2) throw new WorldMachineError('WM_COMMAND_FAILED', 'nope');
        return { id: 536, name: 'Ramp', kind: type, enabled: true };
      },
    });
    const error = (await failure(
      service.applyGraph({ spec: SPEC, planId: id, keepSnapshot: false }),
    )) as WorldMachineError;
    const snapshot = `apply_graph ${id.slice(0, 12)}`;
    expect(error.code).toBe('APPLY_FAILED');
    expect(error.details).toMatchObject({ rolledBack: false, completedSteps: 1, snapshot });
    expect(calls).toContain(`restore ${snapshot}`);
    expect(error.message).toContain(
      `The restore of snapshot '${snapshot}' could not be confirmed; restore it with restore_snapshot or in the World Machine window.`,
    );
  });

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
      unidentifiableWires: [],
      possibleLoops: [],
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

  it('words a non-crash step failure in a changed session as a restart, not a crash', async () => {
    const built: { control?: { generation: number } } = {};
    const result = build({
      addDevice: async (type, count) => {
        if (count === 2) {
          if (built.control) built.control.generation += 1;
          throw new WorldMachineError('WM_COMMAND_FAILED', 'nope');
        }
        return { id: 536, name: 'Ramp', kind: type, enabled: true };
      },
    });
    built.control = result.control;
    const error = (await failure(
      result.service.applyGraph({ spec: SPEC, planId: result.id, keepSnapshot: false }),
    )) as WorldMachineError;
    expect(error.code).toBe('APPLY_FAILED');
    expect(error.details).toMatchObject({
      failedStep: { index: 1, code: 'WM_COMMAND_FAILED' },
      rolledBack: false,
    });
    expect(error.message).toContain(
      `World Machine restarted during the step (its session changed), so nothing was restored, and snapshot 'apply_graph ${result.id.slice(0, 12)}' is gone with it: a snapshot lives only in memory until a save (fact 59).`,
    );
    expect(error.message).not.toContain('crashed');
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

describe('ApplyGraphService port types (port-types design section 6, plan decision D8)', () => {
  it('refuses a plan with an incompatible wire before any command', async () => {
    const calls: string[] = [];
    const record = (name: string) => async () => {
      calls.push(name);
      return [];
    };
    const stub = <T>(value: unknown): T => value as T;
    const spec: RawGraphSpec = {
      version: 1,
      devices: [
        { name: 'Lake', type: 'Create Water' },
        { name: 'Combiner', type: 'Combiner', inputs: { '1': 'Lake.2' } },
      ],
    };
    const session = {
      status: () => ({
        executable: null,
        session: { state: 'ready', binding: { kind: 'fresh' }, dirty: false } as SessionSummary,
      }),
      exclusive: <T>(action: () => Promise<T>) => action(),
    };
    const service = new ApplyGraphService(
      stub<ConstructorParameters<typeof ApplyGraphService>[0]>(session),
      stub<ConstructorParameters<typeof ApplyGraphService>[1]>({
        listDevices: async () => [],
        getDevice: record('get'),
      }),
      stub<ConstructorParameters<typeof ApplyGraphService>[2]>({ addDevice: record('add') }),
      stub<ConstructorParameters<typeof ApplyGraphService>[3]>({ connect: record('connect') }),
      stub<ConstructorParameters<typeof ApplyGraphService>[4]>({}),
      stub<ConstructorParameters<typeof ApplyGraphService>[5]>({ list: record('snapshot list') }),
      syntheticPortTypes,
    );
    const id = planId(validateGraphSpec(spec), { projectPath: null, devices: [], details: [] });
    await expect(service.applyGraph({ spec, planId: id, keepSnapshot: false })).rejects.toMatchObject({
      code: 'REFUSED',
      message:
        "The plan has conflicts; resolve them and plan again: Combiner: 'Lake' output 2 (water system) cannot feed 'Combiner' input 1, which accepts heightfield",
    });
    expect(calls).toEqual([]);
  });
});

describe('ApplyGraphService unidentifiable wires (unidentifiable-wires design section 4)', () => {
  it("carries the plan's list in a view whose diff cannot be read", async () => {
    // Four unwired Combiners in the shape of raw/p2b-graph-edits.txt l.121-126; the diff read after the steps fails.
    const ids = [10, 11, 20, 21];
    const combiner = (id: number): DeviceDetail => ({
      id,
      name: 'Combiner',
      type: 'Combiner',
      enabled: true,
      bypassed: false,
      parameters: [],
      inputs: [
        { port: 1, name: 'Primary Input' },
        { port: 2, name: 'Primary Input' },
      ],
      outputs: [{ port: 1, name: 'Primary Output', targets: [] }],
      portTypes: 'unknown',
    });
    let applied = false;
    const session = {
      status: () => ({
        executable: null,
        session: { state: 'ready', binding: { kind: 'fresh' }, dirty: false } as SessionSummary,
        generation: 1,
      }),
      exclusive: <T>(action: () => Promise<T>) => action(),
    };
    const graph = {
      listDevices: async () => ids.map((id) => ({ id, name: 'Combiner', enabled: true, bypassed: false })),
      getDevice: async (reference: string) => {
        if (applied) throw new WorldMachineError('WM_COMMAND_FAILED', 'read failed');
        return combiner(Number(reference.slice(1)));
      },
    };
    const wires = {
      connect: async () => {
        applied = true;
        return {};
      },
    };
    const snapshots = {
      list: async () => [],
      create: async (name: string) => ({ index: 0, name }),
      remove: async () => ({}),
    };
    const portTypes = { portsOf: () => undefined, portsOfAdded: () => undefined };
    const stub = <T>(value: unknown): T => value as T;
    const spec: RawGraphSpec = {
      version: 1,
      devices: [
        { name: 'a mix', id: 20, type: 'Combiner', inputs: { '1': '#10' } },
        { name: 'b mix', id: 21, type: 'Combiner', inputs: { '1': '#11' } },
      ],
    };
    const plan = await new PlanGraphService(
      stub<ConstructorParameters<typeof PlanGraphService>[0]>(session),
      stub<ConstructorParameters<typeof PlanGraphService>[1]>(graph),
      stub<ConstructorParameters<typeof PlanGraphService>[2]>(portTypes),
    ).planGraph({ spec });
    expect(plan.unidentifiableWires).toHaveLength(2);
    const view = await new ApplyGraphService(
      stub<ConstructorParameters<typeof ApplyGraphService>[0]>(session),
      stub<ConstructorParameters<typeof ApplyGraphService>[1]>(graph),
      stub<ConstructorParameters<typeof ApplyGraphService>[2]>({}),
      stub<ConstructorParameters<typeof ApplyGraphService>[3]>(wires),
      stub<ConstructorParameters<typeof ApplyGraphService>[4]>({}),
      stub<ConstructorParameters<typeof ApplyGraphService>[5]>(snapshots),
      stub<ConstructorParameters<typeof ApplyGraphService>[6]>(portTypes),
    ).applyGraph({ spec, planId: plan.planId, keepSnapshot: false });
    expect(view).toMatchObject({ applied: 2, diffError: 'read failed' });
    expect(view.unidentifiableWires).toEqual(plan.unidentifiableWires);
  });
});

describe('ApplyGraphService loops (wire-loops design section 4)', () => {
  const stub = <T>(value: unknown): T => value as T;
  const session = {
    status: () => ({
      executable: null,
      session: { state: 'ready', binding: { kind: 'fresh' }, dirty: false } as SessionSummary,
      generation: 1,
    }),
    exclusive: <T>(action: () => Promise<T>) => action(),
  };
  /** Combiners in the shape of raw/p2b-graph-edits.txt l.121-126, each listing targets on input 1 and its source. */
  const combiner = (id: number, targets: string[], source?: string): DeviceDetail => ({
    id,
    name: 'Combiner',
    type: 'Combiner',
    enabled: true,
    bypassed: false,
    parameters: [],
    inputs: [
      {
        port: 1,
        name: 'Primary Input',
        ...(source === undefined ? {} : { source: { device: source, port: 1 } }),
      },
      { port: 2, name: 'Primary Input' },
    ],
    outputs: [{ port: 1, name: 'Primary Output', targets: targets.map((device) => ({ device, port: 1 })) }],
    portTypes: 'unknown',
  });
  const spec: RawGraphSpec = {
    version: 1,
    devices: [{ name: 'first mix', id: 10, type: 'Combiner', inputs: { '2': '#20' } }],
  };
  const portTypes = { portsOf: () => undefined, portsOfAdded: () => undefined };

  it('refuses a loop before any snapshot or change command', async () => {
    // #10 feeds #20 on input 1, so #20 into #10 closes a loop.
    const details = [combiner(10, ['Combiner']), combiner(20, [], 'Combiner')];
    const calls: string[] = [];
    const record = (name: string) => async () => {
      calls.push(name);
      return [];
    };
    const graph = {
      listDevices: async () => details.map(({ id }) => ({ id, name: 'Combiner', enabled: true })),
      getDevice: async (reference: string) => details.find((detail) => `#${detail.id}` === reference),
    };
    const state = { projectPath: null, devices: await graph.listDevices(), details };
    const service = new ApplyGraphService(
      stub<ConstructorParameters<typeof ApplyGraphService>[0]>(session),
      stub<ConstructorParameters<typeof ApplyGraphService>[1]>(graph),
      stub<ConstructorParameters<typeof ApplyGraphService>[2]>({ addDevice: record('add') }),
      stub<ConstructorParameters<typeof ApplyGraphService>[3]>({ connect: record('connect') }),
      stub<ConstructorParameters<typeof ApplyGraphService>[4]>({}),
      stub<ConstructorParameters<typeof ApplyGraphService>[5]>({
        list: record('snapshot list'),
        create: record('snapshot create'),
        remove: record('snapshot remove'),
      }),
      stub<ConstructorParameters<typeof ApplyGraphService>[6]>(portTypes),
    );
    const id = planId(validateGraphSpec(spec), state);
    await expect(service.applyGraph({ spec, planId: id, keepSnapshot: false })).rejects.toMatchObject({
      code: 'REFUSED',
      message:
        "The plan has conflicts; resolve them and plan again: first mix: input 2 from 'Combiner' output 1 would close a loop (first mix -> Combiner #20); World Machine refuses a wire that closes a loop (fact 99)",
    });
    expect(calls).toEqual([]);
  });

  it("carries the plan's possibleLoops in a view whose diff cannot be read", async () => {
    // #10 feeds #21 and #11 feeds #20, each on input 1: the plan cannot tell whether #10 reaches #20.
    const details = [
      combiner(10, ['Combiner']),
      combiner(11, ['Combiner']),
      combiner(20, [], 'Combiner'),
      combiner(21, [], 'Combiner'),
    ];
    let applied = false;
    const graph = {
      listDevices: async () => details.map(({ id }) => ({ id, name: 'Combiner', enabled: true })),
      getDevice: async (reference: string) => {
        if (applied) throw new WorldMachineError('WM_COMMAND_FAILED', 'read failed');
        return details.find((detail) => `#${detail.id}` === reference);
      },
    };
    const wires = {
      connect: async () => {
        applied = true;
        return {};
      },
    };
    const snapshots = {
      list: async () => [],
      create: async (name: string) => ({ index: 0, name }),
      remove: async () => ({}),
    };
    const plan = await new PlanGraphService(
      stub<ConstructorParameters<typeof PlanGraphService>[0]>(session),
      stub<ConstructorParameters<typeof PlanGraphService>[1]>(graph),
      stub<ConstructorParameters<typeof PlanGraphService>[2]>(portTypes),
    ).planGraph({ spec });
    expect(plan.possibleLoops).toHaveLength(1);
    const view = await new ApplyGraphService(
      stub<ConstructorParameters<typeof ApplyGraphService>[0]>(session),
      stub<ConstructorParameters<typeof ApplyGraphService>[1]>(graph),
      stub<ConstructorParameters<typeof ApplyGraphService>[2]>({}),
      stub<ConstructorParameters<typeof ApplyGraphService>[3]>(wires),
      stub<ConstructorParameters<typeof ApplyGraphService>[4]>({}),
      stub<ConstructorParameters<typeof ApplyGraphService>[5]>(snapshots),
      stub<ConstructorParameters<typeof ApplyGraphService>[6]>(portTypes),
    ).applyGraph({ spec, planId: plan.planId, keepSnapshot: false });
    expect(view).toMatchObject({ applied: 1, diffError: 'read failed' });
    expect(view.possibleLoops).toEqual(plan.possibleLoops);
  });
});
