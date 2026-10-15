// The tests run in order against one World Machine session, so a failure cascades to the later ones.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { FsPathPolicy } from '../../src/adapter/out/fs/path-policy.js';
import { ENUM_CATALOG } from '../../src/adapter/out/worldmachine/enum-options.js';
import { resolveExecutable } from '../../src/adapter/out/worldmachine/locator.js';
import { throwIfFailed } from '../../src/adapter/out/worldmachine/raw-response.js';
import { WorldMachineDeviceEditor } from '../../src/adapter/out/worldmachine/world-machine-device-editor.js';
import { WorldMachineGraphReader } from '../../src/adapter/out/worldmachine/world-machine-graph-reader.js';
import { WorldMachineParameterEditor } from '../../src/adapter/out/worldmachine/world-machine-parameter-editor.js';
import {
  PORT_TYPE_CATALOG,
  WorldMachinePortTypes,
} from '../../src/adapter/out/worldmachine/world-machine-port-types.js';
import { WorldMachineProcess } from '../../src/adapter/out/worldmachine/world-machine-process.js';
import { WorldMachineProjectWriter } from '../../src/adapter/out/worldmachine/world-machine-project-writer.js';
import { WorldMachineSceneEditor } from '../../src/adapter/out/worldmachine/world-machine-scene-editor.js';
import { WorldMachineSession } from '../../src/adapter/out/worldmachine/world-machine-session.js';
import { WorldMachineSnapshotEditor } from '../../src/adapter/out/worldmachine/world-machine-snapshot-editor.js';
import { WorldMachineWireEditor } from '../../src/adapter/out/worldmachine/world-machine-wire-editor.js';
import { ApplyGraphService } from '../../src/application/service/apply-graph-service.js';
import { PlanGraphService } from '../../src/application/service/plan-graph-service.js';
import { WorldMachineError } from '../../src/domain/errors.js';
import type { RawGraphSpec } from '../../src/domain/graph-spec.js';
import { captureLogger } from '../support/fake-wm.js';

const executable = resolveExecutable(process.env.WORLD_MACHINE_BIN ?? null);
const LIVE = process.env.WM_LIVE === '1' && executable !== null;

describe.skipIf(!LIVE)('live World Machine plan_graph and apply_graph (spec v3 section 8)', () => {
  const logger = captureLogger();
  // describe.skipIf still runs this body at collection, so only create the directory when the run is live.
  const liveRoot = LIVE ? mkdtempSync(join(tmpdir(), 'wm-live-v3-')) : '';
  const session = new WorldMachineSession({
    executable,
    defaultProject: undefined,
    pathPolicy: new FsPathPolicy([liveRoot]),
    commandTimeoutMs: 30_000,
    idleTimeoutMs: 0,
    logger,
    startProcess: (bin, signal, onSpawn) =>
      WorldMachineProcess.start({ bin, readyTimeoutMs: 120_000, logger, signal, onSpawn }),
  });
  // Port-types plan decision D3: the shared reader and wire editor carry the shipped catalog and port types, as
  // main.ts wires them.
  const portTypes = new WorldMachinePortTypes(session, PORT_TYPE_CATALOG);
  const reader = new WorldMachineGraphReader(session, ENUM_CATALOG, portTypes);
  const writer = new WorldMachineProjectWriter(session);
  const scene = new WorldMachineSceneEditor(session);
  const plan = new PlanGraphService(session, reader, portTypes);
  const devices = new WorldMachineDeviceEditor(session);
  const wires = new WorldMachineWireEditor(session, portTypes);
  const apply = new ApplyGraphService(
    session,
    reader,
    devices,
    wires,
    new WorldMachineParameterEditor(session),
    new WorldMachineSnapshotEditor(session),
    portTypes,
  );
  const names = async () => (await reader.listDevices()).map((device) => device.name);
  const planAndApply = async (spec: RawGraphSpec) => {
    const planned = await plan.planGraph({ spec });
    expect(planned.conflicts).toEqual([]);
    return apply.applyGraph({ spec, planId: planned.planId, keepSnapshot: false });
  };
  // Close-then-quit always runs, so the licence seat returns (spec fact 20).
  afterAll(async () => {
    try {
      await session.shutdown();
    } finally {
      rmSync(liveRoot, { recursive: true, force: true });
    }
  }, 60_000);

  const THREE: RawGraphSpec = {
    version: 1,
    devices: [
      { name: 'Ramp', type: 'Gradient', parameters: { Direction: 1, Width: 0.5 } },
      { name: 'Ramp B', type: 'Gradient' },
      // Spec fact 80: World Machine ignores a rename of a Combiner, so it keeps its default name.
      { name: 'Combiner', type: 'Combiner', inputs: { '1': 'Ramp', '2': 'Ramp B' } },
    ],
  };

  it('applies a three-device spec to a new project', async () => {
    await session.ensureRunning();
    await writer.createProject();
    await scene.configureScene({ resolution: 257 });
    const view = await planAndApply(THREE);
    expect(view.applied).toBe(7);
    expect(view.diff.map((entry) => [entry.device, entry.change])).toEqual([
      ['Ramp', 'added'],
      ['Ramp B', 'added'],
      ['Combiner', 'added'],
    ]);
    // The read-back World Machine displays: an int as given, Width in km at 8 km per unit (facts 87-90).
    expect(view.diff[0]).toMatchObject({ after: { parameters: { Direction: '1', Width: '4 km' } } });
    expect(await names()).toEqual(expect.arrayContaining(['Ramp', 'Ramp B', 'Combiner']));
  }, 120_000);

  it('plans only the float step for the same spec again', async () => {
    const again = await plan.planGraph({ spec: THREE });
    expect(again.steps).toEqual([
      expect.objectContaining({ op: 'set-parameter', name: 'Width', comparable: false }),
    ]);
  }, 60_000);

  it('rewires a device and removes one', async () => {
    const view = await planAndApply({
      version: 1,
      devices: [{ name: 'Combiner', type: 'Combiner', inputs: { '1': 'Ramp B', '2': null } }],
      remove: ['Ramp'],
    });
    expect(view.diff).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ device: 'Ramp', change: 'removed' }),
        expect.objectContaining({
          device: 'Combiner',
          change: 'changed',
          inputs: { '1': { before: 'Ramp.1', after: 'Ramp B.1' }, '2': { before: 'Ramp B.1', after: null } },
        }),
      ]),
    );
    expect(await names()).not.toContain('Ramp');
  }, 120_000);

  it('rolls back a spec whose added device has an unknown parameter', async () => {
    const before = await reader.listDevices();
    const spec: RawGraphSpec = {
      version: 1,
      devices: [{ name: 'Extra', type: 'Gradient', parameters: { Nonexistent: 1 } }],
    };
    const planned = await plan.planGraph({ spec });
    let failure: WorldMachineError | undefined;
    try {
      await apply.applyGraph({ spec, planId: planned.planId, keepSnapshot: false });
    } catch (error) {
      if (error instanceof WorldMachineError) failure = error;
      else throw error;
    }
    expect(failure?.code).toBe('APPLY_FAILED');
    expect(failure?.details).toMatchObject({ rolledBack: true, completedSteps: 1 });
    expect(await reader.listDevices()).toEqual(before);
  }, 120_000);

  // Revision 6. The project holds 'Ramp B' and a 'Combiner' fed by it from the tests above, so three Combiners exist.
  it('binds two Combiners by id, converges, and disconnects a Combiner wire while others exist', async () => {
    const first = (await devices.addDevice('Combiner')).id;
    const second = (await devices.addDevice('Combiner')).id;
    const spec: RawGraphSpec = {
      version: 1,
      devices: [
        { name: 'Ramp B', type: 'Gradient' },
        { name: 'first mix', id: first, type: 'Combiner', inputs: { '1': 'Ramp B' } },
        { name: 'second mix', id: second, type: 'Combiner', inputs: { '1': 'first mix' } },
      ],
    };
    await planAndApply(spec);
    const again = await plan.planGraph({ spec });
    expect(again.conflicts).toEqual([]);
    expect(again.steps.filter((step) => step.op !== 'set-parameter' || step.comparable)).toEqual([]);
    // Fact 82's assumption: a Combiner lists its output targets as other devices do.
    expect((await reader.getDevice(`#${first}`)).outputs).toEqual([
      expect.objectContaining({ port: 1, targets: [{ device: 'Combiner', port: 1 }] }),
    ]);
    expect((await wires.disconnect({ device: `#${first}` }, { device: `#${second}` })).removed).toBe(true);
    expect((await reader.getDevice(`#${second}`)).inputs[0]?.source).toBeUndefined();
  }, 180_000);

  // Port-types design section 8. The lowlands trial saw a File Output refuse a Water System (backlog l.104); no capture
  // before raw/port-types.txt shows it.
  it('reports a Water System wired into a File Output as a conflict and shows Create Water port types', async () => {
    await session.ensureRunning();
    throwIfFailed(await session.executeOne('project new blank force'));
    const view = await plan.planGraph({
      spec: {
        version: 1,
        devices: [
          { name: 'Lake', type: 'Create Water' },
          // raw/v3-rename-types.txt l.204-205: an accepted add word for a Height Output (B1 addendum ruling).
          { name: 'Water Out', type: 'File Output', inputs: { '1': 'Lake.2' } },
        ],
      },
    });
    const water = portTypes.portsOfAdded('Create Water');
    const fileOutput = portTypes.portsOf('Height Output');
    expect(water?.outputs[1]?.name).toBe('Water System');
    const accepted = fileOutput?.inputs[0]?.accepts.map((accepts) => accepts.name).join(', ');
    expect(view.conflicts).toEqual([
      {
        entry: 'Water Out',
        reason: `'Lake' output 2 (water system) cannot feed 'Water Out' input 1, which accepts ${accepted}`,
      },
    ]);
    expect(accepted).not.toContain('water system');
    expect(view.uncheckedWires).toEqual([]);
    const added = await devices.addDevice('Create Water');
    const device = await reader.getDevice(`#${added.id}`);
    expect(device.portTypes).toBe('catalogued');
    expect(device.outputs.map((output) => output.type)).toEqual(
      water?.outputs.map((output) => output.type.name),
    );
    expect(device.inputs.map((input) => input.accepts)).toEqual(
      water?.inputs.map((input) => input.accepts.map((accepts) => accepts.name)),
    );
  }, 120_000);

  // Unidentifiable-wires design section 6, live row: the fake scenario of graph-services.test.ts in a blank project.
  it('warns of two Combiner pairs, applies them, and the next plan reports the conflict the warning predicted', async () => {
    await session.ensureRunning();
    throwIfFailed(await session.executeOne('project new blank force'));
    const ids: number[] = [];
    for (let added = 0; added < 4; added += 1) ids.push((await devices.addDevice('Combiner')).id);
    const [a = 0, b = 0, c = 0, d = 0] = ids;
    const spec: RawGraphSpec = {
      version: 1,
      devices: [
        { name: 'a mix', id: c, type: 'Combiner', inputs: { '1': `#${a}` } },
        { name: 'b mix', id: d, type: 'Combiner', inputs: { '1': `#${b}` } },
      ],
    };
    const planned = await plan.planGraph({ spec });
    expect(planned.conflicts).toEqual([]);
    const each = `#${a}, #${b} each list 'Combiner' input 1`;
    expect(planned.unidentifiableWires).toEqual([
      `'a mix' input 1 from 'Combiner' output 1: ${each}`,
      `'b mix' input 1 from 'Combiner' output 1: ${each}`,
    ]);
    const view = await apply.applyGraph({ spec, planId: planned.planId, keepSnapshot: false });
    expect(view.applied).toBe(2);
    expect(view.unidentifiableWires).toEqual(planned.unidentifiableWires);
    const again = await plan.planGraph({ spec });
    const reason = expect.stringContaining(`${each} among their output targets`);
    expect(again.conflicts).toEqual([
      { entry: 'a mix', reason },
      { entry: 'b mix', reason },
    ]);
    expect(again.unidentifiableWires).toEqual([]);
  }, 180_000);

  // Wire-loops design section 6, live row: a two-device loop in a blank project.
  it('reports a wire that closes a two-device loop as a conflict, and apply_graph refuses it before any change', async () => {
    await session.ensureRunning();
    throwIfFailed(await session.executeOne('project new blank force'));
    const a = (await devices.addDevice('Combiner')).id;
    const b = (await devices.addDevice('Combiner')).id;
    expect((await wires.connect({ device: `#${a}` }, { device: `#${b}` })).created).toBe(true);
    const spec: RawGraphSpec = {
      version: 1,
      devices: [{ name: 'first mix', id: a, type: 'Combiner', inputs: { '2': `#${b}` } }],
    };
    const planned = await plan.planGraph({ spec });
    const reason = `input 2 from 'Combiner' output 1 would close a loop (first mix -> Combiner #${b}); World Machine refuses a wire that closes a loop (fact 99)`;
    expect(planned.conflicts).toEqual([{ entry: 'first mix', reason }]);
    expect(planned.possibleLoops).toEqual([]);
    await expect(
      apply.applyGraph({ spec, planId: planned.planId, keepSnapshot: false }),
    ).rejects.toMatchObject({ code: 'REFUSED' });
    const first = await reader.getDevice(`#${a}`);
    expect(first.inputs.find((input) => input.port === 2)?.source).toBeUndefined();
  }, 180_000);

  // Revision 7. The tests above end in a blank project, so this one adds the Gradient it renames.
  it('renames a device by id and plans no rename the second time (revision 7)', async () => {
    await session.ensureRunning();
    throwIfFailed(await session.executeOne('project new blank force'));
    const added = await devices.addDevice('Gradient', 'Ramp B');
    const spec: RawGraphSpec = {
      version: 1,
      devices: [{ name: 'Ramp Renamed', id: added.id, type: 'Gradient', rename: true }],
    };
    const view = await planAndApply(spec);
    expect(view.diff).toEqual([
      {
        device: 'Ramp Renamed',
        change: 'changed',
        id: added.id,
        name: { before: 'Ramp B', after: 'Ramp Renamed' },
      },
    ]);
    expect((await plan.planGraph({ spec })).steps).toEqual([]);
  }, 120_000);
});
