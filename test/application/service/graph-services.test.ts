import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FsPathPolicy } from '../../../src/adapter/out/fs/path-policy.js';
import { WorldMachineDeviceEditor } from '../../../src/adapter/out/worldmachine/world-machine-device-editor.js';
import { WorldMachineGraphReader } from '../../../src/adapter/out/worldmachine/world-machine-graph-reader.js';
import { WorldMachineProcess } from '../../../src/adapter/out/worldmachine/world-machine-process.js';
import { WorldMachineSession } from '../../../src/adapter/out/worldmachine/world-machine-session.js';
import { WorldMachineSnapshotEditor } from '../../../src/adapter/out/worldmachine/world-machine-snapshot-editor.js';
import { PlanGraphService } from '../../../src/application/service/plan-graph-service.js';
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
  const plan = new PlanGraphService(session, reader);
  return { record, session, reader, devices, snapshots, plan };
}

const SPEC: RawGraphSpec = {
  version: 1,
  devices: [
    { name: 'Ramp', type: 'Gradient', parameters: { Width: 0.5 } },
    { name: 'Mix', type: 'Combiner', inputs: { '1': 'Ramp' } },
  ],
};
const CHANGES = /^(device (add|delete|rename|enable|disable)|param set|wire (connect|disconnect)|snapshot)/;

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
