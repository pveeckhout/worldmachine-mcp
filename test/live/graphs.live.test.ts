// The tests run in order against one World Machine session, so a failure cascades to the later ones.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { FsPathPolicy } from '../../src/adapter/out/fs/path-policy.js';
import { resolveExecutable } from '../../src/adapter/out/worldmachine/locator.js';
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
  const reader = new WorldMachineGraphReader(session);
  const writer = new WorldMachineProjectWriter(session);
  const scene = new WorldMachineSceneEditor(session);
  // Port-types plan decision D3: the live tests use the shipped catalog, as main.ts does.
  const portTypes = new WorldMachinePortTypes(session, PORT_TYPE_CATALOG);
  const plan = new PlanGraphService(session, reader, portTypes);
  const devices = new WorldMachineDeviceEditor(session);
  const wires = new WorldMachineWireEditor(session);
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
});
