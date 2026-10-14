import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FsPathPolicy } from '../../../src/adapter/out/fs/path-policy.js';
import { ENUM_CATALOG } from '../../../src/adapter/out/worldmachine/enum-options.js';
import { WorldMachineBuildResultReader } from '../../../src/adapter/out/worldmachine/world-machine-build-result-reader.js';
import { WorldMachineBuilder } from '../../../src/adapter/out/worldmachine/world-machine-builder.js';
import { WorldMachineDeviceEditor } from '../../../src/adapter/out/worldmachine/world-machine-device-editor.js';
import { WorldMachineExporter } from '../../../src/adapter/out/worldmachine/world-machine-exporter.js';
import { WorldMachineGraphReader } from '../../../src/adapter/out/worldmachine/world-machine-graph-reader.js';
import { WorldMachineGroupEditor } from '../../../src/adapter/out/worldmachine/world-machine-group-editor.js';
import { WorldMachineParameterEditor } from '../../../src/adapter/out/worldmachine/world-machine-parameter-editor.js';
import {
  type PortTypeCatalog,
  WorldMachinePortTypes,
} from '../../../src/adapter/out/worldmachine/world-machine-port-types.js';
import { WorldMachineProcess } from '../../../src/adapter/out/worldmachine/world-machine-process.js';
import { WorldMachineSession } from '../../../src/adapter/out/worldmachine/world-machine-session.js';
import { WorldMachineSnapshotEditor } from '../../../src/adapter/out/worldmachine/world-machine-snapshot-editor.js';
import { WorldMachineWireEditor } from '../../../src/adapter/out/worldmachine/world-machine-wire-editor.js';
import { ApplyGraphService } from '../../../src/application/service/apply-graph-service.js';
import { BuildProjectService } from '../../../src/application/service/build-project-service.js';
import { LastFullBuildRecord } from '../../../src/application/service/last-full-build-record.js';
import { PlanGraphService } from '../../../src/application/service/plan-graph-service.js';
import { WorldMachineError } from '../../../src/domain/errors.js';
import type { RawGraphSpec } from '../../../src/domain/graph-spec.js';
import { captureLogger, FAKE_WM, fakeEnv, recorder } from '../../support/fake-wm.js';
import { SYNTHETIC_CATALOG } from '../../support/port-types.js';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'graph-services-')));
const sessions: WorldMachineSession[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.shutdown()));
});

/**
 * The v3 services over one session and the fake World Machine, which starts with its sample project (ids from #536).
 * `catalog`: the port types of the reader, the wire editor, and both services; none by default (port-types plan
 * decision D3).
 */
function wired(extra: Record<string, string> = {}, catalog?: PortTypeCatalog) {
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
  const portTypes = new WorldMachinePortTypes(session, catalog);
  const reader = new WorldMachineGraphReader(session, ENUM_CATALOG, portTypes);
  const devices = new WorldMachineDeviceEditor(session);
  const snapshots = new WorldMachineSnapshotEditor(session);
  const wires = new WorldMachineWireEditor(session, portTypes);
  const plan = new PlanGraphService(session, reader, portTypes);
  const apply = new ApplyGraphService(
    session,
    reader,
    devices,
    wires,
    new WorldMachineParameterEditor(session),
    snapshots,
    portTypes,
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
    // Spec fact 80: World Machine ignores a rename of a Combiner, so it keeps its default name.
    { name: 'Combiner', type: 'Combiner', inputs: { '1': 'Ramp' } },
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
        { op: 'add', device: 'Combiner', type: 'Combiner' },
        { op: 'set-parameter', device: 'Ramp', name: 'Width', to: '0.5', comparable: false },
        { op: 'connect', device: 'Combiner', port: 1, from: 'Ramp.1', source: { device: 'Ramp', port: 1 } },
      ],
      unchanged: [],
      // Port-types plan decision D2: no catalog, so the planned wire is unchecked.
      uncheckedWires: ["'Combiner' input 1"],
      unidentifiableWires: [],
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
    await w.devices.addDevice('River', 'Ramp');
    const view = await w.plan.planGraph({ spec: SPEC });
    // Combiner's input from Ramp is a second conflict: its source is a managed device with a conflict.
    expect(view.conflicts).toContainEqual({
      entry: 'Ramp',
      reason: "#536 has type 'River', not 'Gradient'",
    });
  });

  it('gives the same planId for an unchanged project and another after a change', async () => {
    const w = wired();
    const first = (await w.plan.planGraph({ spec: SPEC })).planId;
    expect((await w.plan.planGraph({ spec: SPEC })).planId).toBe(first);
    await w.devices.addDevice('Gradient');
    expect((await w.plan.planGraph({ spec: SPEC })).planId).not.toBe(first);
  });

  it('reports an id no device has and a Combiner named other than Combiner (revision 6)', async () => {
    const w = wired();
    const view = await w.plan.planGraph({
      spec: {
        version: 1,
        devices: [
          { name: 'Mix', type: 'Combiner' },
          { name: 'Ghost', id: 999, type: 'Gradient' },
        ],
      },
    });
    expect(view.conflicts).toEqual([
      { entry: 'Mix', reason: expect.stringContaining('add it with add_device and give its id') },
      { entry: 'Ghost', reason: '#999 matches no listed device; an entry with id never adds a device' },
    ]);
    expect(view.steps).toEqual([]);
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
            // Float-units facts 87 and 89: the session starts with `project new default`, where 0.5 x 8 km shows as 4 km.
            parameters: { Width: '4 km' },
            inputs: {},
          },
        },
        {
          device: 'Combiner',
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
      unidentifiableWires: [],
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
        // Float-units facts 87 and 89: 0.5 x 8 km shows as 4 km in the default project.
        from: '4 km',
        to: '0.5',
        comparable: false,
      },
    ]);
    expect(again.unchanged).toEqual(['Combiner']);
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
    await w.devices.addDevice('Combiner');
    await w.wires.connect({ device: '#536' }, { device: '#537' });
    const spec: RawGraphSpec = {
      version: 1,
      devices: [
        { name: 'Base', type: 'Gradient' },
        { name: 'Combiner', type: 'Combiner', inputs: { '1': 'Base' } },
      ],
      remove: ['Old'],
    };
    const plan = await w.plan.planGraph({ spec });
    expect(plan.steps.map((step) => step.op)).toEqual(['disconnect', 'remove', 'add', 'connect']);
    const view = await w.apply.applyGraph({ spec, planId: plan.planId, keepSnapshot: false });
    expect(view.diff).toEqual([
      {
        device: 'Combiner',
        change: 'changed',
        id: 537,
        inputs: { '1': { before: 'Old.1', after: 'Base.1' } },
      },
      { device: 'Old', change: 'removed', before: { id: 536, type: 'Gradient' } },
      {
        device: 'Base',
        change: 'added',
        after: { id: 538, type: 'Gradient', enabled: true, bypassed: false, parameters: {}, inputs: {} },
      },
    ]);
  });

  it('shows the input a remove cuts on a managed device that no other step touches', async () => {
    const w = wired();
    await w.devices.addDevice('Gradient', 'Old');
    await w.devices.addDevice('Combiner');
    await w.wires.connect({ device: '#536' }, { device: '#537' });
    const spec: RawGraphSpec = {
      version: 1,
      devices: [{ name: 'Combiner', type: 'Combiner' }],
      remove: ['Old'],
    };
    const plan = await w.plan.planGraph({ spec });
    expect(plan.steps).toEqual([
      { op: 'remove', device: 'Old', id: 536, wiresRemoved: ['Old.1 -> Combiner.1'] },
    ]);
    expect(plan.unchanged).toEqual([]);
    const view = await w.apply.applyGraph({ spec, planId: plan.planId, keepSnapshot: false });
    expect(view.diff).toEqual([
      { device: 'Old', change: 'removed', before: { id: 536, type: 'Gradient' } },
      { device: 'Combiner', change: 'changed', id: 537, inputs: { '1': { before: 'Old.1', after: null } } },
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
    await w.devices.addDevice('River', 'Ramp');
    const plan = await w.plan.planGraph({ spec: SPEC });
    const error = await failure(w.apply.applyGraph({ spec: SPEC, planId: plan.planId, keepSnapshot: false }));
    expect(error).toMatchObject({ code: 'REFUSED', message: expect.stringContaining("type 'River'") });
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
    // The text holds for a snapshot that a failed `snapshot create` made before any step ran, too.
    expect(retry.message).toBe(
      `A snapshot named '${snapshotOf(plan.planId)}' already exists for this plan: an earlier apply_graph left it, or ` +
        'a snapshot create that failed made it before any step ran; inspect or restore it, then remove it with ' +
        'delete_snapshot before applying again',
    );
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
      new WorldMachineBuildResultReader(w.session),
      new LastFullBuildRecord(),
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
      unidentifiableWires: [],
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

describe('apply_graph with device ids (spec v3 revision 6)', () => {
  // Section 5's layered graph: base and hills into one Combiner, it and the mountains into a second, the second into
  // an erosion. Both Combiners are bound by id: a Combiner keeps its default name (fact 80).
  const layered = (first: number, second: number): RawGraphSpec => ({
    version: 1,
    devices: [
      { name: 'Base', type: 'Gradient', parameters: { Width: 0.5 } },
      { name: 'Hills', type: 'Gradient' },
      { name: 'Mountains', type: 'Gradient' },
      { name: 'hills mix', id: first, type: 'Combiner', inputs: { '1': 'Base', '2': 'Hills' } },
      { name: 'mountain mix', id: second, type: 'Combiner', inputs: { '1': 'hills mix', '2': 'Mountains' } },
      { name: 'Eroded', type: 'Erosion', inputs: { '1': 'mountain mix' } },
    ],
  });

  /** Adds two Combiners (#536, #537) and applies the layered graph over them (#538-#541 are added). */
  async function applyLayered(w: ReturnType<typeof wired>) {
    const first = (await w.devices.addDevice('Combiner')).id;
    const second = (await w.devices.addDevice('Combiner')).id;
    const spec = layered(first, second);
    const plan = await w.plan.planGraph({ spec });
    expect(plan.conflicts).toEqual([]);
    const view = await w.apply.applyGraph({ spec, planId: plan.planId, keepSnapshot: false });
    return { spec, view, first, second };
  }

  it('applies the layered graph, and a second plan holds only comparable: false steps', async () => {
    const w = wired();
    const { spec, view } = await applyLayered(w);
    expect(view.applied).toBe(10);
    expect(view.diff.map((entry) => [entry.device, entry.change])).toEqual([
      ['Base', 'added'],
      ['Hills', 'added'],
      ['Mountains', 'added'],
      ['Eroded', 'added'],
      ['hills mix', 'changed'],
      ['mountain mix', 'changed'],
    ]);
    expect(w.record.lines().filter((line) => /^device rename #53[67] /.test(line))).toEqual([]);
    const again = await w.plan.planGraph({ spec });
    expect(again.conflicts).toEqual([]);
    expect(again.steps).toEqual([
      {
        op: 'set-parameter',
        device: 'Base',
        id: 538,
        name: 'Width',
        // Float-units facts 87 and 89: 0.5 x 8 km shows as 4 km in the default project.
        from: '4 km',
        to: '0.5',
        comparable: false,
      },
    ]);
    expect(again.unchanged).toEqual(['Hills', 'Mountains', 'hills mix', 'mountain mix', 'Eroded']);
  });

  it('reads the unmanaged device that shares a source name in a second phase (section 5)', async () => {
    const w = wired();
    const { second } = await applyLayered(w);
    const before = w.record.lines().length;
    const spec: RawGraphSpec = {
      version: 1,
      devices: [{ name: 'Eroded', type: 'Erosion', inputs: { '1': `#${second}` } }],
    };
    expect(await w.plan.planGraph({ spec })).toMatchObject({
      conflicts: [],
      steps: [],
      unchanged: ['Eroded'],
    });
    expect(
      w.record
        .lines()
        .slice(before)
        .filter((line) => line.startsWith('device select ')),
    ).toEqual(['device select #541', 'device select #537', 'device select #536']);
  });

  it('moves an input from one Combiner to the other through the wire editor (lowlands item 2)', async () => {
    const w = wired();
    const { spec, first, second } = await applyLayered(w);
    const moved: RawGraphSpec = {
      ...spec,
      devices: spec.devices.map((device) =>
        device.name === 'Eroded' ? { ...device, inputs: { '1': 'hills mix' } } : device,
      ),
    };
    const plan = await w.plan.planGraph({ spec: moved });
    expect(plan.conflicts).toEqual([]);
    expect(plan.steps.filter((step) => step.op !== 'set-parameter')).toEqual([
      {
        op: 'disconnect',
        device: 'Eroded',
        id: 541,
        port: 1,
        from: 'mountain mix.1',
        source: { device: 'mountain mix', id: second, port: 1 },
      },
      {
        op: 'connect',
        device: 'Eroded',
        id: 541,
        port: 1,
        from: 'hills mix.1',
        source: { device: 'hills mix', id: first, port: 1 },
      },
    ]);
    const before = w.record.lines().length;
    await w.apply.applyGraph({ spec: moved, planId: plan.planId, keepSnapshot: false });
    expect(
      w.record
        .lines()
        .slice(before)
        .filter((line) => /^wire (connect|disconnect) /.test(line)),
    ).toEqual([`wire disconnect #${second}.1 #541.1`, `wire connect #${first}.1 #541.1`]);
    const again = await w.plan.planGraph({ spec: moved });
    expect(again.steps.map((step) => step.op)).toEqual(['set-parameter']);
  });
});

describe('port types over the fake World Machine (port-types design section 8)', () => {
  const WATER_CONFLICT = {
    entry: 'Combiner',
    reason:
      "'Create Water' output 2 (water system) cannot feed 'Combiner' input 1, which accepts heightfield",
  };
  const SPEC_WATER: RawGraphSpec = {
    version: 1,
    devices: [
      { name: 'Create Water', type: 'Create Water' },
      { name: 'Combiner', type: 'Combiner', inputs: { '1': 'Create Water.2' } },
    ],
  };

  it('plans a Water System into a Combiner the project holds as a conflict, and apply_graph changes nothing', async () => {
    const w = wired({}, SYNTHETIC_CATALOG);
    // Codex round 3 nit: both exist, so the plan types the Create Water by its ports (the fingerprint), which needs
    // the fake to list Create Water's captured ports.
    await w.devices.addDevice('Create Water');
    await w.devices.addDevice('Combiner');
    const plan = await w.plan.planGraph({ spec: SPEC_WATER });
    expect(plan.conflicts).toEqual([WATER_CONFLICT]);
    expect(plan.uncheckedWires).toEqual([]);
    const before = w.record.lines().length;
    await expect(
      w.apply.applyGraph({ spec: SPEC_WATER, planId: plan.planId, keepSnapshot: false }),
    ).rejects.toMatchObject({
      code: 'REFUSED',
      message: `The plan has conflicts; resolve them and plan again: Combiner: ${WATER_CONFLICT.reason}`,
    });
    expect(
      w.record
        .lines()
        .slice(before)
        .filter((line) => CHANGES.test(line)),
    ).toEqual([]);
  });

  it('connects a Water System to Existing Water and names the types when World Machine refuses one', async () => {
    const w = wired({}, SYNTHETIC_CATALOG);
    const lake = await w.devices.addDevice('Create Water');
    const sea = await w.devices.addDevice('Create Water');
    const mix = await w.devices.addDevice('Combiner');
    expect(
      (await w.wires.connect({ device: `#${lake.id}`, port: 2 }, { device: `#${sea.id}`, port: 2 })).created,
    ).toBe(true);
    await expect(
      w.wires.connect({ device: `#${lake.id}`, port: 2 }, { device: `#${mix.id}` }),
    ).rejects.toMatchObject({
      code: 'WM_COMMAND_FAILED',
      message: `World Machine rejected "wire connect #${lake.id}.2 #${mix.id}": output 2 is water system; input 1 accepts heightfield`,
    });
  });
});

describe('unidentifiable wires over the fake World Machine (unidentifiable-wires design section 6)', () => {
  /** Adds `count` Combiners; the fake's sample project holds none, so they are the only devices named Combiner. */
  async function combiners(w: ReturnType<typeof wired>, count: number): Promise<number[]> {
    const ids: number[] = [];
    for (let added = 0; added < count; added += 1) ids.push((await w.devices.addDevice('Combiner')).id);
    return ids;
  }
  /** Two pairs: the first two Combiners each feed input 1 of one of the next two. */
  const pairs = ([a = 0, b = 0, c = 0, d = 0]: number[]): RawGraphSpec => ({
    version: 1,
    devices: [
      { name: 'a mix', id: c, type: 'Combiner', inputs: { '1': `#${a}` } },
      { name: 'b mix', id: d, type: 'Combiner', inputs: { '1': `#${b}` } },
    ],
  });

  it('carries the list of the plan apply_graph applied', async () => {
    const w = wired();
    const spec = pairs(await combiners(w, 4));
    const plan = await w.plan.planGraph({ spec });
    expect(plan.unidentifiableWires).toHaveLength(2);
    const view = await w.apply.applyGraph({ spec, planId: plan.planId, keepSnapshot: false });
    expect(view.unidentifiableWires).toEqual(plan.unidentifiableWires);
  });

  it('warns of two Combiner pairs, applies them, and the next plan reports the conflict the warning predicted', async () => {
    const w = wired();
    // #536-#539 are the pairs; #540 is an unmanaged Combiner the third read phase reads.
    const [a = 0, b = 0, c = 0, d = 0, e = 0] = await combiners(w, 5);
    const spec = pairs([a, b, c, d]);
    const before = w.record.lines().length;
    const plan = await w.plan.planGraph({ spec });
    expect(
      w.record
        .lines()
        .slice(before)
        .filter((line) => line.startsWith('device select ')),
    ).toEqual([
      `device select #${c}`,
      `device select #${d}`,
      `device select #${a}`,
      `device select #${b}`,
      `device select #${e}`,
    ]);
    expect(plan.conflicts).toEqual([]);
    const each = `#${a}, #${b} each list 'Combiner' input 1`;
    expect(plan.unidentifiableWires).toEqual([
      `'a mix' input 1 from 'Combiner' output 1: ${each}`,
      `'b mix' input 1 from 'Combiner' output 1: ${each}`,
    ]);
    const view = await w.apply.applyGraph({ spec, planId: plan.planId, keepSnapshot: false });
    expect(view.applied).toBe(2);
    expect(view.unidentifiableWires).toEqual(plan.unidentifiableWires);
    const again = await w.plan.planGraph({ spec });
    const reason = `input 1 is wired from 'Combiner', a name #${a}, #${b}, #${c}, #${d}, #${e} share, and ${each} among their output targets; wire list names devices, so the wire's source cannot be identified`;
    expect(again.conflicts).toEqual([
      { entry: 'a mix', reason },
      { entry: 'b mix', reason },
    ]);
    expect(again.steps).toEqual([]);
    // Plan decision D2: a conflict is not listed twice.
    expect(again.unidentifiableWires).toEqual([]);
  });
});

describe('a wire that closes a loop over the fake World Machine (spec fact 99)', () => {
  const CYCLE =
    'Error: Error: These ports cannot be connected as the result will create a cycle in the graph!';

  it('connect_devices fails with WM_COMMAND_FAILED carrying the cycle sentence', async () => {
    const w = wired();
    const a = (await w.devices.addDevice('Combiner')).id;
    const b = (await w.devices.addDevice('Combiner')).id;
    expect((await w.wires.connect({ device: `#${a}`, port: 1 }, { device: `#${b}`, port: 1 })).created).toBe(
      true,
    );
    await expect(
      w.wires.connect({ device: `#${b}`, port: 1 }, { device: `#${a}`, port: 2 }),
    ).rejects.toMatchObject({
      code: 'WM_COMMAND_FAILED',
      message: `World Machine rejected "wire connect #${b}.1 #${a}.2"`,
      // The sentence travels in worldMachineMessage, which the tool result passes on to the client.
      worldMachineMessage: CYCLE,
    });
  });

  it('apply_graph fails at the closing connect, rolls back, and carries the cycle sentence', async () => {
    const w = wired();
    const a = (await w.devices.addDevice('Combiner')).id;
    const b = (await w.devices.addDevice('Combiner')).id;
    const spec: RawGraphSpec = {
      version: 1,
      devices: [
        { name: 'first mix', id: a, type: 'Combiner', inputs: { '2': 'second mix' } },
        { name: 'second mix', id: b, type: 'Combiner', inputs: { '1': 'first mix' } },
      ],
    };
    const plan = await w.plan.planGraph({ spec });
    expect(plan.conflicts).toEqual([]);
    const error = await failure(w.apply.applyGraph({ spec, planId: plan.planId, keepSnapshot: false }));
    expect(error.code).toBe('APPLY_FAILED');
    expect(error.details).toMatchObject({
      failedStep: { code: 'WM_COMMAND_FAILED', worldMachineMessage: CYCLE },
      rolledBack: true,
    });
    expect((await w.reader.listDevices()).map((device) => device.id)).toEqual(expect.arrayContaining([a, b]));
  });
});
