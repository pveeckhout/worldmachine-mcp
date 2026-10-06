// The tests run in order against one World Machine session, so a failure cascades to the later ones.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { FsPathPolicy } from '../../src/adapter/out/fs/path-policy.js';
import { resolveExecutable } from '../../src/adapter/out/worldmachine/locator.js';
import { WorldMachineBuilder } from '../../src/adapter/out/worldmachine/world-machine-builder.js';
import { WorldMachineDeviceEditor } from '../../src/adapter/out/worldmachine/world-machine-device-editor.js';
import { WorldMachineExporter } from '../../src/adapter/out/worldmachine/world-machine-exporter.js';
import { WorldMachineGraphReader } from '../../src/adapter/out/worldmachine/world-machine-graph-reader.js';
import { WorldMachineGroupEditor } from '../../src/adapter/out/worldmachine/world-machine-group-editor.js';
import { WorldMachineProcess } from '../../src/adapter/out/worldmachine/world-machine-process.js';
import { WorldMachineProjectWriter } from '../../src/adapter/out/worldmachine/world-machine-project-writer.js';
import { WorldMachineSceneEditor } from '../../src/adapter/out/worldmachine/world-machine-scene-editor.js';
import { WorldMachineSession } from '../../src/adapter/out/worldmachine/world-machine-session.js';
import { WorldMachineSnapshotEditor } from '../../src/adapter/out/worldmachine/world-machine-snapshot-editor.js';
import { AddDeviceService } from '../../src/application/service/add-device-service.js';
import { BuildProjectService } from '../../src/application/service/build-project-service.js';
import { CreateSnapshotService } from '../../src/application/service/create-snapshot-service.js';
import { DeleteSnapshotService } from '../../src/application/service/delete-snapshot-service.js';
import { ExportOutputsService } from '../../src/application/service/export-outputs-service.js';
import { ListDevicesService } from '../../src/application/service/list-devices-service.js';
import { ListGroupsService } from '../../src/application/service/list-groups-service.js';
import { ListSnapshotsService } from '../../src/application/service/list-snapshots-service.js';
import { OpenProjectService } from '../../src/application/service/open-project-service.js';
import { OrganizeDevicesService } from '../../src/application/service/organize-devices-service.js';
import { RestoreSnapshotService } from '../../src/application/service/restore-snapshot-service.js';
import { SaveProjectService } from '../../src/application/service/save-project-service.js';
import { SetGroupEnabledService } from '../../src/application/service/set-group-enabled-service.js';
import { UndoService } from '../../src/application/service/undo-service.js';
import type { Group } from '../../src/domain/group.js';
import { captureLogger } from '../support/fake-wm.js';

const executable = resolveExecutable(process.env.WORLD_MACHINE_BIN ?? null);
const LIVE = process.env.WM_LIVE === '1' && executable !== null;

describe.skipIf(!LIVE)('live World Machine snapshots, organize, and groups (spec v2b section 7)', () => {
  const logger = captureLogger();
  // describe.skipIf still runs this body at collection, so only create the directory when the run is live.
  const liveRoot = LIVE ? mkdtempSync(join(tmpdir(), 'wm-live-v2b-')) : '';
  const project = join(liveRoot, 'v2b.tmd');
  const policy = new FsPathPolicy([liveRoot]);
  const session = new WorldMachineSession({
    executable,
    defaultProject: undefined,
    pathPolicy: policy,
    commandTimeoutMs: 30_000,
    idleTimeoutMs: 0,
    logger,
    startProcess: (bin, signal, onSpawn) =>
      WorldMachineProcess.start({ bin, readyTimeoutMs: 120_000, logger, signal, onSpawn }),
  });
  const reader = new WorldMachineGraphReader(session);
  const writer = new WorldMachineProjectWriter(session);
  const devices = new WorldMachineDeviceEditor(session);
  const scene = new WorldMachineSceneEditor(session);
  const exporter = new WorldMachineExporter(session);
  const snapshots = new WorldMachineSnapshotEditor(session);
  const groups = new WorldMachineGroupEditor(session);
  const builder = new WorldMachineBuilder(session);
  const listSnapshots = new ListSnapshotsService(session, snapshots);
  const createSnapshot = new CreateSnapshotService(session, snapshots);
  const restoreSnapshot = new RestoreSnapshotService(session, snapshots);
  const deleteSnapshot = new DeleteSnapshotService(session, snapshots);
  const organizeDevices = new OrganizeDevicesService(session, devices);
  const listGroups = new ListGroupsService(session, groups);
  const setGroupEnabled = new SetGroupEnabledService(session, groups);
  const buildProject = new BuildProjectService(session, builder, exporter, reader, policy, groups);
  const listDevices = new ListDevicesService(session, reader);
  const addDevice = new AddDeviceService(session, devices);
  const undo = new UndoService(session, writer);
  const saveProject = new SaveProjectService(session, policy, writer);
  const openProject = new OpenProjectService(session, policy, writer);
  const exportOutputs = new ExportOutputsService(session, exporter, reader, policy);
  const deviceIds = async () => (await listDevices.listDevices({})).devices.map((device) => device.id);
  const disabledCount = async () =>
    (await listDevices.listDevices({})).devices.filter((device) => !device.enabled).length;
  // Close-then-quit always runs, so the licence seat returns (spec fact 20); a build still running is stopped first.
  afterAll(async () => {
    try {
      await session.shutdown();
    } finally {
      rmSync(liveRoot, { recursive: true, force: true });
    }
  }, 60_000);

  // The default project's first group with devices, found in the group test and built in the build test.
  let group: Group | undefined;

  it('restores a snapshot over an edit, and one undo brings the edit back (facts 58-60)', async () => {
    await session.ensureRunning();
    await writer.createProject();
    await scene.configureScene({ resolution: 257 });
    await saveProject.saveProject({ path: project, overwrite: false });
    expect(await createSnapshot.createSnapshot({ name: 'before gradient' })).toMatchObject({
      index: 0,
      name: 'before gradient',
      session: { dirty: true },
    });
    const added = await addDevice.addDevice({ type: 'Gradient' });
    expect(await restoreSnapshot.restoreSnapshot({ snapshot: 'before gradient' })).toMatchObject({
      index: 0,
      name: 'before gradient',
      session: { dirty: true },
    });
    expect(await deviceIds()).not.toContain(added.device.id);
    await undo.undo({});
    expect(await deviceIds()).toContain(added.device.id);
  }, 180_000);

  it('refuses a repeated name and deletes a snapshot, shifting the later ones down (facts 58 and 61)', async () => {
    expect(await createSnapshot.createSnapshot({ name: 'variant b' })).toMatchObject({ index: 1 });
    await expect(createSnapshot.createSnapshot({ name: 'variant b' })).rejects.toMatchObject({
      code: 'REFUSED',
    });
    const deleted = await deleteSnapshot.deleteSnapshot({ snapshot: '#0' });
    expect(deleted).toMatchObject({ index: 0, name: 'before gradient' });
    expect(deleted.remaining.map(({ index, name }) => ({ index, name }))).toEqual([
      { index: 0, name: 'variant b' },
    ]);
  }, 60_000);

  it('organizes the devices as an unsaved change (fact 62)', async () => {
    await saveProject.saveProject({ path: project, overwrite: true });
    expect(await organizeDevices.organizeDevices({})).toMatchObject({ session: { dirty: true } });
  }, 60_000);

  it('keeps only the saved snapshots across a save and a reopen (fact 59)', async () => {
    await saveProject.saveProject({ path: project, overwrite: true });
    await createSnapshot.createSnapshot({ name: 'never saved' });
    await openProject.openProject({ path: project, discardUnsaved: true });
    expect((await listSnapshots.listSnapshots({})).snapshots.map((snapshot) => snapshot.name)).toEqual([
      'variant b',
    ]);
  }, 120_000);

  it('disables and enables every member of a group, checked with list_devices (fact 64)', async () => {
    group = (await listGroups.listGroups({})).groups.find((candidate) => candidate.deviceCount > 0);
    expect(group).toBeDefined();
    if (group === undefined) return;
    const before = await disabledCount();
    expect(
      await setGroupEnabled.setGroupEnabled({ group: group.name.toUpperCase(), enabled: false }),
    ).toMatchObject({ index: group.index, deviceCount: group.deviceCount, enabled: false });
    expect(await disabledCount()).toBeGreaterThanOrEqual(before + 1);
    expect(await setGroupEnabled.setGroupEnabled({ group: `#${group.index}`, enabled: true })).toMatchObject({
      enabled: true,
      session: { dirty: true },
    });
    expect(await disabledCount()).toBe(before);
  }, 60_000);

  it('builds one group to its late line, and the outputs stay unexportable (facts 66 and 67)', async () => {
    expect(group).toBeDefined();
    if (group === undefined) return;
    expect(
      await buildProject.buildProject({ mode: 'group', group: `#${group.index}`, waitSeconds: 300 }),
    ).toMatchObject({ state: 'finished', mode: 'group', group });
    await expect(exportOutputs.exportOutputs({})).rejects.toMatchObject({ code: 'WM_COMMAND_FAILED' });
  }, 360_000);
});
