import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FsPathPolicy } from '../../../src/adapter/out/fs/path-policy.js';
import { WorldMachineBuilder } from '../../../src/adapter/out/worldmachine/world-machine-builder.js';
import { WorldMachineDeviceEditor } from '../../../src/adapter/out/worldmachine/world-machine-device-editor.js';
import { WorldMachineExporter } from '../../../src/adapter/out/worldmachine/world-machine-exporter.js';
import { WorldMachineGraphReader } from '../../../src/adapter/out/worldmachine/world-machine-graph-reader.js';
import { WorldMachineGroupEditor } from '../../../src/adapter/out/worldmachine/world-machine-group-editor.js';
import { WorldMachineParameterEditor } from '../../../src/adapter/out/worldmachine/world-machine-parameter-editor.js';
import { WorldMachineProcess } from '../../../src/adapter/out/worldmachine/world-machine-process.js';
import { WorldMachineSession } from '../../../src/adapter/out/worldmachine/world-machine-session.js';
import { WorldMachineSnapshotEditor } from '../../../src/adapter/out/worldmachine/world-machine-snapshot-editor.js';
import { WorldMachineWireEditor } from '../../../src/adapter/out/worldmachine/world-machine-wire-editor.js';
import { ApplyGraphService } from '../../../src/application/service/apply-graph-service.js';
import { BuildProjectService } from '../../../src/application/service/build-project-service.js';
import { PlanGraphService } from '../../../src/application/service/plan-graph-service.js';
import { WorldMachineError } from '../../../src/domain/errors.js';
import type { RawGraphSpec } from '../../../src/domain/graph-spec.js';
import { captureLogger, FAKE_WM, fakeEnv, recorder } from '../../support/fake-wm.js';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'graph-services-')));
const sessions: WorldMachineSession[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.shutdown()));
});

/** The v3 services over one session and the fake World Machine, which starts with its sample project (ids from #536). */
function wired(extra: Record<string, string> = {}) {
  const record = recorder();
  const logger = captureLogger();
  const env = fakeEnv({ FAKE_WM_RECORD: record.path, ...extra });
  const session = new WorldMachineSession({
    executable: FAKE_WM,
    defaultProject: undefined,
    pathPolicy: new FsPathPolicy([root]),
    commandTimeoutMs: 2_000,
    idleTimeoutMs: 0,
    logger,
    startProcess: (bin, signal, onSpawn) =>
      WorldMachineProcess.start({ bin, readyTimeoutMs: 5_000, logger, env, signal, onSpawn }),
  });
  sessions.push(session);
  const reader = new WorldMachineGraphReader(session);
  const devices = new WorldMachineDeviceEditor(session);
  const snapshots = new WorldMachineSnapshotEditor(session);
  const wires = new WorldMachineWireEditor(session);
  const plan = new PlanGraphService(session, reader);
  const apply = new ApplyGraphService(
    session,
    reader,
    devices,
    wires,
    new WorldMachineParameterEditor(session),
    snapshots,
  );
  return {
    record,
    session,
    reader,
    devices,
    wires,
    snapshots,
    plan,
    apply,
    policy: new FsPathPolicy([root]),
  };
}

const SPEC: RawGraphSpec = {
  version: 1,
  devices: [
    { name: 'Ramp', type: 'Gradient', parameters: { Width: 0.5 } },
    { name: 'Mix', type: 'Combiner', inputs: { '1': 'Ramp' } },
  ],
};
const CHANGES =
  /^(device (add|delete|rename|enable|disable|bypass)|param set|wire (connect|disconnect)|snapshot)/;

describe('PlanGraphService (spec v3 sections 3 and 5)', () => {
  it('plans a spec against the project with read commands only', async () => {
    const w = wired();
    const view = await w.plan.planGraph({ spec: SPEC });
    expect(view).toEqual({
      planId: expect.stringMatching(/^[0-9a-f]{64}$/),
      conflicts: [],
      steps: [
        { op: 'add', device: 'Ramp', type: 'Gradient' },
        { op: 'add', device: 'Mix', type: 'Combiner' },
        { op: 'set-parameter', device: 'Ramp', name: 'Width', to: '0.5', comparable: false },
        { op: 'connect', device: 'Mix', port: 1, from: 'Ramp.1', source: { device: 'Ramp', port: 1 } },
      ],
      unchanged: [],
      session: expect.objectContaining({ state: 'ready' }),
    });
    expect(w.record.lines().filter((line) => CHANGES.test(line))).toEqual([]);
  });

  it('refuses an invalid spec before sending anything', async () => {
    const w = wired();
    await expect(w.plan.planGraph({ spec: { ...SPEC, version: 2 } })).rejects.toMatchObject({
      code: 'REFUSED',
    });
    expect(w.record.lines()).toEqual([]);
  });

  it('returns a plan with conflicts instead of refusing it', async () => {
    const w = wired();
    await w.devices.addDevice('Combiner', 'Ramp');
    const view = await w.plan.planGraph({ spec: SPEC });
    // Mix's input from Ramp is a second conflict: its source is a managed device with a conflict.
    expect(view.conflicts).toContainEqual({
      entry: 'Ramp',
      reason: "#536 has type 'Combiner', not 'Gradient'",
    });
  });

  it('gives the same planId for an unchanged project and another after a change', async () => {
    const w = wired();
    const first = (await w.plan.planGraph({ spec: SPEC })).planId;
    expect((await w.plan.planGraph({ spec: SPEC })).planId).toBe(first);
    await w.devices.addDevice('Gradient');
    expect((await w.plan.planGraph({ spec: SPEC })).planId).not.toBe(first);
  });
});

async function failure(action: Promise<unknown>): Promise<WorldMachineError> {
  try {
    await action;
  } catch (error) {
    if (error instanceof WorldMachineError) return error;
    throw error;
  }
  throw new Error('the call succeeded');
}

const snapshotOf = (planId: string) => `apply_graph ${planId.slice(0, 12)}`;

describe('ApplyGraphService (spec v3 section 6)', () => {
  it('applies a plan, deletes its snapshot, and a second plan holds only float steps', async () => {
    const w = wired();
    const first = await w.plan.planGraph({ spec: SPEC });
    expect(await w.apply.applyGraph({ spec: SPEC, planId: first.planId, keepSnapshot: false })).toEqual({
      applied: 4,
      snapshot: null,
      diff: [
        {
          device: 'Ramp',
          change: 'added',
          after: {
            id: 536,
            type: 'Gradient',
            enabled: true,
            bypassed: false,
            parameters: { Width: '0.5' },
            inputs: {},
          },
        },
        {
          device: 'Mix',
          change: 'added',
          after: {
            id: 537,
            type: 'Combiner',
            enabled: true,
            bypassed: false,
            parameters: {},
            inputs: { '1': 'Ramp.1' },
          },
        },
      ],
      session: expect.objectContaining({ dirty: true }),
    });
    expect(await w.snapshots.list()).toEqual([]);
    const again = await w.plan.planGraph({ spec: SPEC });
    expect(again.steps).toEqual([
      {
        op: 'set-parameter',
        device: 'Ramp',
        id: 536,
        name: 'Width',
        from: '0.5',
        to: '0.5',
        comparable: false,
      },
    ]);
    expect(again.unchanged).toEqual(['Mix']);
  });

  it('adds a bypassed device, shows it bypassed in the diff, and a second plan has no set-bypassed', async () => {
    const w = wired();
    const spec: RawGraphSpec = { version: 1, devices: [{ name: 'Ramp', type: 'Gradient', bypassed: true }] };
    const plan = await w.plan.planGraph({ spec });
    expect(plan.steps).toEqual([
      { op: 'add', device: 'Ramp', type: 'Gradient' },
      { op: 'set-bypassed', device: 'Ramp', to: true },
    ]);
    const view = await w.apply.applyGraph({ spec, planId: plan.planId, keepSnapshot: false });
    expect(view.diff).toEqual([
      {
        device: 'Ramp',
        change: 'added',
        after: { id: 536, type: 'Gradient', enabled: true, bypassed: true, parameters: {}, inputs: {} },
      },
    ]);
    const again = await w.plan.planGraph({ spec });
    expect(again.steps).toEqual([]);
    expect(again.unchanged).toEqual(['Ramp']);
  });

  it('rolls back a set-bypassed on an existing device when a later step fails', async () => {
    const w = wired({ FAKE_WM_PARAM_SET_ERROR_AT: '1' });
    await w.devices.addDevice('Gradient', 'Ramp');
    const spec: RawGraphSpec = {
      version: 1,
      devices: [{ name: 'Ramp', type: 'Gradient', bypassed: true, parameters: { Width: 0.5 } }],
    };
    const plan = await w.plan.planGraph({ spec });
    expect(plan.steps.map((step) => step.op)).toEqual(['set-bypassed', 'set-parameter']);
    const error = await failure(w.apply.applyGraph({ spec, planId: plan.planId, keepSnapshot: false }));
    expect(error.code).toBe('APPLY_FAILED');
    expect(error.details).toMatchObject({ completedSteps: 1, rolledBack: true });
    expect((await w.reader.getDevice('#536')).bypassed).toBe(false);
  });

  it('rewires and removes, and reports removed, added, and changed devices', async () => {
    const w = wired();
    await w.devices.addDevice('Gradient', 'Old');
    await w.devices.addDevice('Combiner', 'Mix');
    await w.wires.connect({ device: '#536' }, { device: '#537' });
    const spec: RawGraphSpec = {
      version: 1,
      devices: [
        { name: 'Base', type: 'Gradient' },
        { name: 'Mix', type: 'Combiner', inputs: { '1': 'Base' } },
      ],
      remove: ['Old'],
    };
    const plan = await w.plan.planGraph({ spec });
    expect(plan.steps.map((step) => step.op)).toEqual(['disconnect', 'remove', 'add', 'connect']);
    const view = await w.apply.applyGraph({ spec, planId: plan.planId, keepSnapshot: false });
    expect(view.diff).toEqual([
      { device: 'Mix', change: 'changed', id: 537, inputs: { '1': { before: 'Old.1', after: 'Base.1' } } },
      { device: 'Old', change: 'removed', before: { id: 536, type: 'Gradient' } },
      {
        device: 'Base',
        change: 'added',
        after: { id: 538, type: 'Gradient', enabled: true, bypassed: false, parameters: {}, inputs: {} },
      },
    ]);
  });

  it('refuses a stale planId before taking a snapshot', async () => {
    const w = wired();
    const plan = await w.plan.planGraph({ spec: SPEC });
    await w.devices.addDevice('Gradient');
    const error = await failure(w.apply.applyGraph({ spec: SPEC, planId: plan.planId, keepSnapshot: false }));
    expect(error).toMatchObject({ code: 'REFUSED', message: expect.stringContaining('plan_graph again') });
    expect(w.record.lines().filter((line) => line.startsWith('snapshot create'))).toEqual([]);
  });

  it('refuses a plan with conflicts', async () => {
    const w = wired();
    await w.devices.addDevice('Combiner', 'Ramp');
    const plan = await w.plan.planGraph({ spec: SPEC });
    const error = await failure(w.apply.applyGraph({ spec: SPEC, planId: plan.planId, keepSnapshot: false }));
    expect(error).toMatchObject({ code: 'REFUSED', message: expect.stringContaining("type 'Combiner'") });
  });

  it('rolls back an add that World Machine resolved to another type (spec fact 81)', async () => {
    const w = wired();
    const spec: RawGraphSpec = { version: 1, devices: [{ name: 'Lake', type: 'Water' }] };
    const plan = await w.plan.planGraph({ spec });
    const before = (await w.reader.listDevices()).map((device) => device.id);
    const error = await failure(w.apply.applyGraph({ spec, planId: plan.planId, keepSnapshot: false }));
    expect(error.code).toBe('APPLY_FAILED');
    expect(error.details).toMatchObject({
      failedStep: { index: 0, step: { op: 'add', device: 'Lake', type: 'Water' }, code: 'WM_COMMAND_FAILED' },
      completedSteps: 0,
      rolledBack: true,
    });
    expect(error.message).toContain("'Coast Erosion'");
    expect(w.record.lines().filter((line) => line.startsWith('device rename'))).toEqual([]);
    expect((await w.reader.listDevices()).map((device) => device.id)).toEqual(before);
  });

  it('rolls back a failing step and keeps the snapshot', async () => {
    const w = wired({ FAKE_WM_PARAM_SET_ERROR_AT: '1' });
    const plan = await w.plan.planGraph({ spec: SPEC });
    const before = (await w.reader.listDevices()).map((device) => device.id);
    const error = await failure(w.apply.applyGraph({ spec: SPEC, planId: plan.planId, keepSnapshot: false }));
    expect(error.code).toBe('APPLY_FAILED');
    expect(error.details).toEqual({
      failedStep: {
        index: 2,
        step: { op: 'set-parameter', device: 'Ramp', name: 'Width', to: '0.5', comparable: false },
        code: 'WM_COMMAND_FAILED',
        message: expect.stringContaining('Width'),
        worldMachineMessage: "Error: Error: Invalid value for '#536.Width'",
      },
      completedSteps: 2,
      rolledBack: true,
      snapshot: snapshotOf(plan.planId),
    });
    expect(error.message).toContain('restored');
    expect((await w.reader.listDevices()).map((device) => device.id)).toEqual(before);
    expect((await w.snapshots.list()).map((snapshot) => snapshot.name)).toEqual([snapshotOf(plan.planId)]);
  });

  it("refuses a retry while the rolled-back apply's snapshot is kept (Review Focus 1, D15)", async () => {
    const w = wired({ FAKE_WM_PARAM_SET_ERROR_AT: '1' });
    const plan = await w.plan.planGraph({ spec: SPEC });
    await failure(w.apply.applyGraph({ spec: SPEC, planId: plan.planId, keepSnapshot: false }));
    const retry = await failure(w.apply.applyGraph({ spec: SPEC, planId: plan.planId, keepSnapshot: false }));
    expect(retry.code).toBe('REFUSED');
    expect(retry.message).toContain(snapshotOf(plan.planId));
    expect(retry.message).toContain('delete_snapshot');
  });

  it('reports rolledBack: false when the restore fails', async () => {
    const w = wired({ FAKE_WM_PARAM_SET_ERROR_AT: '1', FAKE_WM_RESTORE_ERROR: '1' });
    const plan = await w.plan.planGraph({ spec: SPEC });
    const error = await failure(w.apply.applyGraph({ spec: SPEC, planId: plan.planId, keepSnapshot: false }));
    expect(error.details).toMatchObject({ rolledBack: false, completedSteps: 2 });
    expect(error.message).toContain('restore_snapshot');
  });

  it('reports a crash without a restore (Review Focus 2)', async () => {
    const w = wired({ FAKE_WM_CRASH_ON: 'wire connect #536.1 #537.1' });
    const plan = await w.plan.planGraph({ spec: SPEC });
    const error = await failure(w.apply.applyGraph({ spec: SPEC, planId: plan.planId, keepSnapshot: false }));
    expect(error.details).toMatchObject({
      failedStep: { index: 3, code: 'CRASHED' },
      completedSteps: 3,
      rolledBack: false,
    });
    expect(error.message).toContain('gone');
    expect(w.record.lines().filter((line) => line.startsWith('snapshot restore'))).toEqual([]);
  });

  it('refuses while a build runs, and plan_graph still answers', async () => {
    const w = wired({ FAKE_WM_BUILD_MS: '60000' });
    const groups = new WorldMachineGroupEditor(w.session);
    const build = new BuildProjectService(
      w.session,
      new WorldMachineBuilder(w.session),
      new WorldMachineExporter(w.session),
      w.reader,
      w.policy,
      groups,
    );
    await build.buildProject({ mode: 'full', waitSeconds: 0 });
    const plan = await w.plan.planGraph({ spec: SPEC });
    const error = await failure(w.apply.applyGraph({ spec: SPEC, planId: plan.planId, keepSnapshot: false }));
    expect(error).toMatchObject({ code: 'REFUSED', message: expect.stringContaining('A build is running') });
  });

  it('refuses when the apply snapshot name exists', async () => {
    const w = wired();
    const plan = await w.plan.planGraph({ spec: SPEC });
    await w.snapshots.create(snapshotOf(plan.planId));
    const error = await failure(w.apply.applyGraph({ spec: SPEC, planId: plan.planId, keepSnapshot: false }));
    expect(error).toMatchObject({
      code: 'REFUSED',
      message: expect.stringContaining(snapshotOf(plan.planId)),
    });
  });

  it('applies an empty plan without a snapshot', async () => {
    const w = wired();
    const spec: RawGraphSpec = { version: 1, devices: [] };
    const plan = await w.plan.planGraph({ spec });
    expect(await w.apply.applyGraph({ spec, planId: plan.planId, keepSnapshot: false })).toEqual({
      applied: 0,
      snapshot: null,
      diff: [],
      session: expect.objectContaining({ state: 'ready' }),
    });
    expect(w.record.lines().filter((line) => line.startsWith('snapshot'))).toEqual([]);
  });

  it('keeps the snapshot on request', async () => {
    const w = wired();
    const plan = await w.plan.planGraph({ spec: SPEC });
    const view = await w.apply.applyGraph({ spec: SPEC, planId: plan.planId, keepSnapshot: true });
    expect(view.snapshot).toBe(snapshotOf(plan.planId));
    expect((await w.snapshots.list()).map((snapshot) => snapshot.name)).toEqual([snapshotOf(plan.planId)]);
  });

  it('reports a timeout as a stopped World Machine without a restore', async () => {
    const w = wired({ FAKE_WM_HANG_ON: 'wire connect #536.1 #537.1' });
    const plan = await w.plan.planGraph({ spec: SPEC });
    const error = await failure(w.apply.applyGraph({ spec: SPEC, planId: plan.planId, keepSnapshot: false }));
    expect(error.code).toBe('APPLY_FAILED');
    expect(error.details).toMatchObject({
      failedStep: { index: 3, code: 'TIMEOUT' },
      completedSteps: 3,
      rolledBack: false,
    });
    expect(error.message).toContain('gone');
    expect(w.record.lines().filter((line) => line.startsWith('snapshot restore'))).toEqual([]);
  }, 15_000);
});
