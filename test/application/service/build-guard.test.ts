import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FsPathPolicy } from '../../../src/adapter/out/fs/path-policy.js';
import { WorldMachineBuildResultReader } from '../../../src/adapter/out/worldmachine/world-machine-build-result-reader.js';
import { WorldMachineBuilder } from '../../../src/adapter/out/worldmachine/world-machine-builder.js';
import { WorldMachineDeviceEditor } from '../../../src/adapter/out/worldmachine/world-machine-device-editor.js';
import { WorldMachineExporter } from '../../../src/adapter/out/worldmachine/world-machine-exporter.js';
import { WorldMachineGraphReader } from '../../../src/adapter/out/worldmachine/world-machine-graph-reader.js';
import { WorldMachineGroupEditor } from '../../../src/adapter/out/worldmachine/world-machine-group-editor.js';
import { WorldMachineParameterEditor } from '../../../src/adapter/out/worldmachine/world-machine-parameter-editor.js';
import { WorldMachineProcess } from '../../../src/adapter/out/worldmachine/world-machine-process.js';
import { WorldMachineProjectWriter } from '../../../src/adapter/out/worldmachine/world-machine-project-writer.js';
import { WorldMachineSceneEditor } from '../../../src/adapter/out/worldmachine/world-machine-scene-editor.js';
import { WorldMachineSession } from '../../../src/adapter/out/worldmachine/world-machine-session.js';
import { WorldMachineSnapshotEditor } from '../../../src/adapter/out/worldmachine/world-machine-snapshot-editor.js';
import { WorldMachineWireEditor } from '../../../src/adapter/out/worldmachine/world-machine-wire-editor.js';
import { AddDeviceService } from '../../../src/application/service/add-device-service.js';
import { BuildProjectService } from '../../../src/application/service/build-project-service.js';
import { ConfigureSceneService } from '../../../src/application/service/configure-scene-service.js';
import { ConnectDevicesService } from '../../../src/application/service/connect-devices-service.js';
import { CreateProjectService } from '../../../src/application/service/create-project-service.js';
import { CreateSnapshotService } from '../../../src/application/service/create-snapshot-service.js';
import { DeleteDeviceService } from '../../../src/application/service/delete-device-service.js';
import { DeleteSnapshotService } from '../../../src/application/service/delete-snapshot-service.js';
import { DisconnectDevicesService } from '../../../src/application/service/disconnect-devices-service.js';
import { ExportOutputsService } from '../../../src/application/service/export-outputs-service.js';
import { GetBuildStatusService } from '../../../src/application/service/get-build-status-service.js';
import { LastFullBuildRecord } from '../../../src/application/service/last-full-build-record.js';
import { ListDevicesService } from '../../../src/application/service/list-devices-service.js';
import { ListGroupsService } from '../../../src/application/service/list-groups-service.js';
import { ListSnapshotsService } from '../../../src/application/service/list-snapshots-service.js';
import { OpenProjectService } from '../../../src/application/service/open-project-service.js';
import { OrganizeDevicesService } from '../../../src/application/service/organize-devices-service.js';
import { OutputsChecker } from '../../../src/application/service/outputs-checker.js';
import { RedoService } from '../../../src/application/service/redo-service.js';
import { RenameDeviceService } from '../../../src/application/service/rename-device-service.js';
import { RestoreSnapshotService } from '../../../src/application/service/restore-snapshot-service.js';
import { SaveProjectService } from '../../../src/application/service/save-project-service.js';
import { SetDeviceEnabledService } from '../../../src/application/service/set-device-enabled-service.js';
import { SetGroupEnabledService } from '../../../src/application/service/set-group-enabled-service.js';
import { StopBuildService } from '../../../src/application/service/stop-build-service.js';
import { UndoService } from '../../../src/application/service/undo-service.js';
import { UpdateDeviceParametersService } from '../../../src/application/service/update-device-parameters-service.js';
import { NOT_BUILT_HINT } from '../../../src/domain/build-result.js';
import type { WorldMachineError } from '../../../src/domain/errors.js';
import { captureLogger, FAKE_WM, fakeEnv, recorder, waitUntil } from '../../support/fake-wm.js';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'build-guard-')));
const sessions: WorldMachineSession[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.shutdown()));
});

/** get_build_status with a record of its own, for the tests that do not read build_project's record (plan decision D6). */
const statusOf = (session: WorldMachineSession, builder: WorldMachineBuilder) =>
  new GetBuildStatusService(
    session,
    builder,
    new LastFullBuildRecord(),
    new OutputsChecker(
      session,
      new WorldMachineExporter(session),
      new WorldMachineGraphReader(session),
      new WorldMachineBuildResultReader(session),
    ),
  );

/** The services of main.ts over one session and the fake World Machine, whose builds take 60 s. */
function wired(extra: Record<string, string> = {}) {
  const record = recorder();
  const logger = captureLogger();
  const env = fakeEnv({ FAKE_WM_RECORD: record.path, FAKE_WM_BUILD_MS: '60000', ...extra });
  const policy = new FsPathPolicy([root]);
  const session = new WorldMachineSession({
    executable: FAKE_WM,
    defaultProject: undefined,
    pathPolicy: policy,
    commandTimeoutMs: 2_000,
    idleTimeoutMs: 0,
    logger,
    startProcess: (bin, signal, onSpawn) =>
      WorldMachineProcess.start({ bin, readyTimeoutMs: 5_000, logger, env, signal, onSpawn }),
  });
  sessions.push(session);
  const reader = new WorldMachineGraphReader(session);
  const writer = new WorldMachineProjectWriter(session);
  const devices = new WorldMachineDeviceEditor(session);
  const builder = new WorldMachineBuilder(session);
  const exporter = new WorldMachineExporter(session);
  // Build-status-check design section 6: build_project and get_build_status share one record, as in main.ts.
  const lastFullBuild = new LastFullBuildRecord();
  const results = new WorldMachineBuildResultReader(session);
  const checker = new OutputsChecker(session, exporter, reader, results);
  return {
    record,
    session,
    policy,
    reader,
    writer,
    devices,
    builder,
    exporter,
    lastFullBuild,
    results,
    checker,
  };
}

describe('the build guard across the command tools (spec v2a section 4)', () => {
  it('refuses every command tool while a full build runs, keeps the reads working, and lifts after stop_build', async () => {
    const w = wired();
    const { session, policy, reader, writer, devices, builder, exporter } = w;
    const buildProject = new BuildProjectService(
      session,
      builder,
      exporter,
      reader,
      policy,
      new WorldMachineGroupEditor(session),
      new WorldMachineBuildResultReader(session),
      new LastFullBuildRecord(),
    );
    expect(await buildProject.buildProject({ mode: 'full', waitSeconds: 0 })).toMatchObject({
      state: 'running',
    });
    const sent = w.record.lines().length;
    const wires = new WorldMachineWireEditor(session);
    const snapshots = new WorldMachineSnapshotEditor(session);
    const groups = new WorldMachineGroupEditor(session);
    const commands: [string, () => Promise<unknown>][] = [
      [
        'open_project',
        () =>
          new OpenProjectService(session, policy, writer).openProject({
            path: join(root, 'x.tmd'),
            discardUnsaved: true,
          }),
      ],
      [
        'create_project',
        () => new CreateProjectService(session, writer).createProject({ discardUnsaved: true }),
      ],
      [
        'save_project',
        () =>
          new SaveProjectService(session, policy, writer).saveProject({
            path: join(root, 'x.tmd'),
            overwrite: true,
          }),
      ],
      ['add_device', () => new AddDeviceService(session, devices).addDevice({ type: 'Gradient' })],
      [
        'rename_device',
        () => new RenameDeviceService(session, devices).renameDevice({ device: '#1', name: 'A' }),
      ],
      [
        'set_device_enabled',
        () =>
          new SetDeviceEnabledService(session, devices).setDeviceEnabled({ device: '#1', enabled: false }),
      ],
      ['delete_device', () => new DeleteDeviceService(session, devices).deleteDevice({ device: '#1' })],
      [
        'update_device_parameters',
        () =>
          new UpdateDeviceParametersService(
            session,
            new WorldMachineParameterEditor(session),
          ).updateDeviceParameters({ device: '#1', parameters: { Width: 0.5 } }),
      ],
      [
        'connect_devices',
        () =>
          new ConnectDevicesService(session, wires).connectDevices({
            source: { device: '#1' },
            destination: { device: '#2' },
          }),
      ],
      [
        'disconnect_devices',
        () =>
          new DisconnectDevicesService(session, wires).disconnectDevices({
            source: { device: '#1' },
            destination: { device: '#2' },
          }),
      ],
      [
        'configure_scene',
        () =>
          new ConfigureSceneService(session, new WorldMachineSceneEditor(session)).configureScene({
            resolution: 257,
          }),
      ],
      ['undo', () => new UndoService(session, writer).undo({})],
      ['redo', () => new RedoService(session, writer).redo({})],
      ['build_project', () => buildProject.buildProject({ mode: 'preview', waitSeconds: 0 })],
      ['export_outputs', () => new ExportOutputsService(session, exporter, reader, policy).exportOutputs({})],
      // Spec v2b section 3: the new command tools are refused too.
      ['create_snapshot', () => new CreateSnapshotService(session, snapshots).createSnapshot({ name: 'S' })],
      [
        'restore_snapshot',
        () => new RestoreSnapshotService(session, snapshots).restoreSnapshot({ snapshot: '#0' }),
      ],
      [
        'delete_snapshot',
        () => new DeleteSnapshotService(session, snapshots).deleteSnapshot({ snapshot: '#0' }),
      ],
      ['organize_devices', () => new OrganizeDevicesService(session, devices).organizeDevices({})],
      [
        'set_group_enabled',
        () => new SetGroupEnabledService(session, groups).setGroupEnabled({ group: '#0', enabled: false }),
      ],
      [
        'build_project group',
        () => buildProject.buildProject({ mode: 'group', group: '#0', waitSeconds: 0 }),
      ],
    ];
    for (const [name, call] of commands) {
      await expect(call(), name).rejects.toMatchObject({
        code: 'REFUSED',
        message: 'A build is running; call stop_build or wait for it to finish',
      });
    }
    expect(
      w.record
        .lines()
        .slice(sent)
        .filter((line) => line !== ''),
    ).toEqual([]);
    expect((await new ListDevicesService(session, reader).listDevices({})).devices).toHaveLength(17);
    expect((await new ListSnapshotsService(session, snapshots).listSnapshots({})).snapshots).toEqual([]);
    expect((await new ListGroupsService(session, groups).listGroups({})).groups).toHaveLength(5);
    expect((await statusOf(session, builder).getBuildStatus({})).build?.mode).toBe('full');
    expect((await new StopBuildService(session, builder).stopBuild({})).stopped).toBe('full');
    await expect(new UndoService(session, writer).undo({})).resolves.toMatchObject({
      session: { state: 'ready' },
    });
  });
});

async function failure(promise: Promise<unknown>): Promise<WorldMachineError> {
  try {
    await promise;
  } catch (error) {
    return error as WorldMachineError;
  }
  throw new Error('expected rejection');
}

describe('build services over the fake World Machine (spec v2a sections 3-5)', () => {
  it('keeps a tiled build running across the late trailer of the full build before it', async () => {
    const { session, policy, reader, writer, builder, exporter } = wired({ FAKE_WM_LATE_TRAILER: '1' });
    const buildProject = new BuildProjectService(
      session,
      builder,
      exporter,
      reader,
      policy,
      new WorldMachineGroupEditor(session),
      new WorldMachineBuildResultReader(session),
      new LastFullBuildRecord(),
    );
    const stopBuild = new StopBuildService(session, builder);
    await writer.saveProject(join(root, 'late.tmd'), true);
    await buildProject.buildProject({ mode: 'full', waitSeconds: 0 });
    expect((await stopBuild.stopBuild({})).stopped).toBe('full');
    expect(await buildProject.buildProject({ mode: 'tiled', waitSeconds: 0 })).toMatchObject({
      state: 'running',
      mode: 'tiled',
    });
    expect((await statusOf(session, builder).getBuildStatus({})).build?.mode).toBe('tiled');
    expect((await stopBuild.stopBuild({})).stopped).toBe('tiled');
  });

  it('stops a build whose start is still waiting for its opening event', async () => {
    const { session, policy, reader, builder, exporter } = wired({ FAKE_WM_START_DELAY_MS: '300' });
    const building = new BuildProjectService(
      session,
      builder,
      exporter,
      reader,
      policy,
      new WorldMachineGroupEditor(session),
      new WorldMachineBuildResultReader(session),
      new LastFullBuildRecord(),
    ).buildProject({
      mode: 'full',
      waitSeconds: 0,
    });
    await waitUntil(() => session.buildTracker()?.pending === 'full');
    expect((await new StopBuildService(session, builder).stopBuild({})).stopped).toBe('full');
    await building;
    expect(builder.current()).toBeUndefined();
  });

  it('fails stop_build with SHUTTING_DOWN when the server stops during it (decision D14)', async () => {
    const w = wired({ FAKE_WM_DELAY_ON: 'build stop', FAKE_WM_DELAY_MS: '300' });
    const { session, policy, reader, builder, exporter } = w;
    await new BuildProjectService(
      session,
      builder,
      exporter,
      reader,
      policy,
      new WorldMachineGroupEditor(session),
      new WorldMachineBuildResultReader(session),
      new LastFullBuildRecord(),
    ).buildProject({
      mode: 'full',
      waitSeconds: 0,
    });
    const stopping = failure(new StopBuildService(session, builder).stopBuild({}));
    await waitUntil(() => w.record.lines().includes('build stop'));
    await session.shutdown();
    expect((await stopping).code).toBe('SHUTTING_DOWN');
  });

  it('refuses command tools while a tiled build started in the World Machine window runs, until it ends (A1)', async () => {
    const { session, reader, writer, builder } = wired({
      FAKE_WM_BUILD_MS: '1000',
      FAKE_WM_GUI_BUILD: 'tiled',
      FAKE_WM_GUI_BUILD_ON: 'device list',
    });
    expect((await new ListDevicesService(session, reader).listDevices({})).devices).toHaveLength(17);
    expect((await statusOf(session, builder).getBuildStatus({})).build).toMatchObject({
      mode: 'unknown',
      startedBy: 'world-machine',
    });
    expect(await failure(new UndoService(session, writer).undo({}))).toMatchObject({
      code: 'REFUSED',
      message: 'A build is running; call stop_build or wait for it to finish',
    });
    expect(await session.buildTracker()?.ended(5_000)).toBe(true);
    expect((await statusOf(session, builder).getBuildStatus({})).build).toBeNull();
    await expect(new UndoService(session, writer).undo({})).resolves.toMatchObject({
      session: { state: 'ready' },
    });
  });

  it('promotes a build started in the World Machine window to full and stops it (A1)', async () => {
    const { session, reader, writer, builder } = wired({
      FAKE_WM_GUI_BUILD: 'full',
      FAKE_WM_GUI_BUILD_ON: 'device list',
    });
    await new ListDevicesService(session, reader).listDevices({});
    expect((await statusOf(session, builder).getBuildStatus({})).build).toMatchObject({
      mode: 'full',
      startedBy: 'world-machine',
    });
    expect((await new StopBuildService(session, builder).stopBuild({})).stopped).toBe('full');
    await expect(new UndoService(session, writer).undo({})).resolves.toMatchObject({
      session: { state: 'ready' },
    });
  });

  it('finishes a full build only at its late Build started., so an export right after it succeeds (fact 54)', async () => {
    const { session, policy, reader, writer, builder, exporter } = wired({
      FAKE_WM_BUILD_MS: '100',
      FAKE_WM_LATE_MS: '500',
    });
    await writer.saveProject(join(root, 'timing.tmd'), true);
    expect(
      await new BuildProjectService(
        session,
        builder,
        exporter,
        reader,
        policy,
        new WorldMachineGroupEditor(session),
        new WorldMachineBuildResultReader(session),
        new LastFullBuildRecord(),
      ).buildProject({
        mode: 'full',
        waitSeconds: 10,
      }),
    ).toMatchObject({
      state: 'finished',
      mode: 'full',
      // The fake does not model the sample project's own devices, so get_device of its Height Output #1 fails and the
      // check reports why (spec section 6); the build is still finished.
      outputsCheckError: 'World Machine rejected "debug devicetiming #1"',
    });
    const exported = await new ExportOutputsService(session, exporter, reader, policy).exportOutputs({});
    expect(exported.files).toHaveLength(4);
  });

  it('refuses command tools during a group build, which ends at its late line and leaves exports refused (spec v2b facts 66-67)', async () => {
    const { session, policy, reader, writer, builder, exporter } = wired({ FAKE_WM_BUILD_MS: '500' });
    const groups = new WorldMachineGroupEditor(session);
    const buildProject = new BuildProjectService(
      session,
      builder,
      exporter,
      reader,
      policy,
      groups,
      new WorldMachineBuildResultReader(session),
      new LastFullBuildRecord(),
    );
    await writer.saveProject(join(root, 'group.tmd'), true);
    expect(await buildProject.buildProject({ mode: 'group', group: '#0', waitSeconds: 0 })).toMatchObject({
      state: 'running',
      mode: 'group',
      group: { index: 0, name: 'Create your Terrain', deviceCount: 6 },
    });
    expect((await statusOf(session, builder).getBuildStatus({})).build).toMatchObject({
      mode: 'full',
      startedBy: 'server',
    });
    expect(await failure(new UndoService(session, writer).undo({}))).toMatchObject({
      code: 'REFUSED',
      message: 'A build is running; call stop_build or wait for it to finish',
    });
    expect(await groups.list()).toHaveLength(5);
    expect(await builder.waitForEnd('group', 5_000)).toBe(true);
    expect(
      await buildProject.buildProject({ mode: 'group', group: 'create your terrain', waitSeconds: 10 }),
    ).toMatchObject({ state: 'finished', mode: 'group' });
    expect(
      await failure(new ExportOutputsService(session, exporter, reader, policy).exportOutputs({})),
    ).toMatchObject({ code: 'WM_COMMAND_FAILED' });
  });

  it('stops a group build, reports it as full, and lifts the guard (spec v2b section 3, assumption B6)', async () => {
    const { session, policy, reader, writer, builder, exporter } = wired();
    const groups = new WorldMachineGroupEditor(session);
    await new BuildProjectService(
      session,
      builder,
      exporter,
      reader,
      policy,
      groups,
      new WorldMachineBuildResultReader(session),
      new LastFullBuildRecord(),
    ).buildProject({
      mode: 'group',
      group: '#0',
      waitSeconds: 0,
    });
    expect((await new StopBuildService(session, builder).stopBuild({})).stopped).toBe('full');
    expect(builder.current()).toBeUndefined();
    await expect(new UndoService(session, writer).undo({})).resolves.toMatchObject({
      session: { state: 'ready' },
    });
  });

  it('stops a running group build before it closes the project on shutdown (spec v2a section 5)', async () => {
    const w = wired();
    const { session, policy, reader, builder, exporter } = w;
    const groups = new WorldMachineGroupEditor(session);
    await new BuildProjectService(
      session,
      builder,
      exporter,
      reader,
      policy,
      groups,
      new WorldMachineBuildResultReader(session),
      new LastFullBuildRecord(),
    ).buildProject({
      mode: 'group',
      group: '#0',
      waitSeconds: 0,
    });
    await session.shutdown();
    const lines = w.record.lines();
    expect(lines.indexOf('build stop')).toBeGreaterThan(lines.indexOf('group build #0'));
    expect(lines.indexOf('build stop')).toBeLessThan(lines.indexOf('project close force'));
  });

  it('reports no build when its end arrives inside the build status frame (fact 47)', async () => {
    const { session, policy, reader, builder, exporter } = wired({ FAKE_WM_BUILD_END_ON: 'build status' });
    await new BuildProjectService(
      session,
      builder,
      exporter,
      reader,
      policy,
      new WorldMachineGroupEditor(session),
      new WorldMachineBuildResultReader(session),
      new LastFullBuildRecord(),
    ).buildProject({
      mode: 'full',
      waitSeconds: 0,
    });
    expect(await statusOf(session, builder).getBuildStatus({})).toMatchObject({
      build: null,
      previewRunning: false,
    });
  });

  it('reports the output a console-added River did not build, and where building stopped (build-not-built section 8)', async () => {
    const { session, policy, reader, devices, builder, exporter } = wired({ FAKE_WM_BUILD_MS: '100' });
    const wires = new WorldMachineWireEditor(session);
    // raw/build-not-built-timing.txt l.1-46: Gradient into River into File Output in a blank project.
    await session.execute(['project new blank force']);
    const gradient = await devices.addDevice('Gradient');
    const river = await devices.addDevice('River');
    const output = await devices.addDevice('File Output');
    await wires.connect({ device: `#${gradient.id}` }, { device: `#${river.id}`, port: 1 });
    await wires.connect({ device: `#${river.id}` }, { device: `#${output.id}` });
    const buildProject = new BuildProjectService(
      session,
      builder,
      exporter,
      reader,
      policy,
      new WorldMachineGroupEditor(session),
      new WorldMachineBuildResultReader(session),
      new LastFullBuildRecord(),
    );
    expect(await buildProject.buildProject({ mode: 'full', waitSeconds: 10 })).toEqual({
      state: 'finished',
      mode: 'full',
      elapsedSeconds: expect.any(Number),
      outputsBuilt: false,
      notBuilt: [{ id: output.id, name: 'Height Output' }],
      stoppedAt: [{ id: river.id, name: 'River', type: 'River', enabled: true, bypassed: false }],
      hint: NOT_BUILT_HINT,
      session: expect.any(Object),
    });
  });

  it('reports every output built for Gradient into File Output (build-not-built section 8, l.119-149)', async () => {
    const { session, policy, reader, devices, builder, exporter } = wired({ FAKE_WM_BUILD_MS: '100' });
    await session.execute(['project new blank force']);
    const gradient = await devices.addDevice('Gradient');
    const output = await devices.addDevice('File Output');
    await new WorldMachineWireEditor(session).connect(
      { device: `#${gradient.id}` },
      { device: `#${output.id}` },
    );
    const buildProject = new BuildProjectService(
      session,
      builder,
      exporter,
      reader,
      policy,
      new WorldMachineGroupEditor(session),
      new WorldMachineBuildResultReader(session),
      new LastFullBuildRecord(),
    );
    expect(await buildProject.buildProject({ mode: 'full', waitSeconds: 10 })).toEqual({
      state: 'finished',
      mode: 'full',
      elapsedSeconds: expect.any(Number),
      outputsBuilt: true,
      notBuilt: [],
      stoppedAt: [],
      session: expect.any(Object),
    });
  });

  it('checks a full build that stop_build ended during the wait (spec section 3, plan decision B10)', async () => {
    // wired() builds for 60 s, so the build is still running when stop_build ends it.
    const { session, policy, reader, devices, builder, exporter } = wired();
    await session.execute(['project new blank force']);
    const gradient = await devices.addDevice('Gradient');
    const output = await devices.addDevice('File Output');
    await new WorldMachineWireEditor(session).connect(
      { device: `#${gradient.id}` },
      { device: `#${output.id}` },
    );
    const building = new BuildProjectService(
      session,
      builder,
      exporter,
      reader,
      policy,
      new WorldMachineGroupEditor(session),
      new WorldMachineBuildResultReader(session),
      new LastFullBuildRecord(),
    ).buildProject({ mode: 'full', waitSeconds: 30 });
    await waitUntil(() => builder.current()?.state === 'running');
    expect((await new StopBuildService(session, builder).stopBuild({})).stopped).toBe('full');
    // Spec section 3 and fact 95: the build reads as finished, the check ran, and the output it never reached is not
    // built. The fake's stopped build leaves every device without results (Assumed there).
    const view = await building;
    expect(view).toMatchObject({
      state: 'finished',
      mode: 'full',
      outputsBuilt: false,
      notBuilt: [{ id: output.id, name: 'Height Output' }],
      hint: NOT_BUILT_HINT,
    });
    expect('outputsCheckError' in view).toBe(false);
    // Task 6 minor: a check refused its exclusive() action would say so here.
    expect(JSON.stringify(view)).not.toMatch(/A build is running/);
  });

  /**
   * Build-status-check design section 7: a graph in a blank project, a full build that outlives a 0 s wait, and the
   * wait for its end (plan decision D5). `river` adds a River between the Gradient and the File Output.
   */
  async function outlivedBuild(w: ReturnType<typeof wired>, river: boolean) {
    const { session, policy, reader, devices, builder, exporter, lastFullBuild, results, checker } = w;
    const wires = new WorldMachineWireEditor(session);
    await session.execute(['project new blank force']);
    const gradient = await devices.addDevice('Gradient');
    const middle = river ? await devices.addDevice('River') : undefined;
    const output = await devices.addDevice('File Output');
    if (middle === undefined) {
      await wires.connect({ device: `#${gradient.id}` }, { device: `#${output.id}` });
    } else {
      await wires.connect({ device: `#${gradient.id}` }, { device: `#${middle.id}`, port: 1 });
      await wires.connect({ device: `#${middle.id}` }, { device: `#${output.id}` });
    }
    const buildProject = new BuildProjectService(
      session,
      builder,
      exporter,
      reader,
      policy,
      new WorldMachineGroupEditor(session),
      results,
      lastFullBuild,
    );
    expect(await buildProject.buildProject({ mode: 'full', waitSeconds: 0 })).toMatchObject({
      state: 'running',
      mode: 'full',
    });
    await waitUntil(() => builder.last()?.state === 'ended');
    const startedAt = new Date(builder.last()?.startedAt ?? 0).toISOString();
    return {
      gradient,
      middle,
      output,
      startedAt,
      status: new GetBuildStatusService(session, builder, lastFullBuild, checker),
    };
  }

  it('reports in get_build_status the output a River did not build in a full build that outlived the wait (build-status-check section 7)', async () => {
    const { middle, output, startedAt, status } = await outlivedBuild(
      wired({ FAKE_WM_BUILD_MS: '100' }),
      true,
    );
    expect((await status.getBuildStatus({})).lastFullBuild).toEqual({
      startedAt,
      outputsBuilt: false,
      notBuilt: [{ id: output.id, name: 'Height Output' }],
      stoppedAt: [{ id: middle?.id, name: 'River', type: 'River', enabled: true, bypassed: false }],
      hint: NOT_BUILT_HINT,
    });
  });

  it('reports in get_build_status every output built for Gradient into File Output (build-status-check section 7)', async () => {
    const { startedAt, status } = await outlivedBuild(wired({ FAKE_WM_BUILD_MS: '100' }), false);
    expect((await status.getBuildStatus({})).lastFullBuild).toEqual({
      startedAt,
      outputsBuilt: true,
      notBuilt: [],
      stoppedAt: [],
    });
  });

  it('reports that the project changed after update_device_parameters between the end and get_build_status (build-status-check section 7)', async () => {
    const w = wired({ FAKE_WM_BUILD_MS: '100' });
    const { gradient, startedAt, status } = await outlivedBuild(w, true);
    await new UpdateDeviceParametersService(
      w.session,
      new WorldMachineParameterEditor(w.session),
    ).updateDeviceParameters({ device: `#${gradient.id}`, parameters: { Width: 0.5 } });
    const sent = w.record.lines().length;
    expect((await status.getBuildStatus({})).lastFullBuild).toEqual({
      startedAt,
      outputsCheckError: 'The project changed after the build ended; run build_project again.',
    });
    // Design section 3: without reads; only get_build_status's own `build status` is sent (batch sentinel filtered).
    expect(
      w.record
        .lines()
        .slice(sent)
        .filter((line) => !line.startsWith('__end_')),
    ).toEqual(['build status']);
  });

  it('checks an outlived build after save_project, which changes nothing (plan decision D1)', async () => {
    const w = wired({ FAKE_WM_BUILD_MS: '100' });
    const { startedAt, status } = await outlivedBuild(w, false);
    await w.writer.saveProject(join(root, 'checked.tmd'), true);
    expect((await status.getBuildStatus({})).lastFullBuild).toEqual({
      startedAt,
      outputsBuilt: true,
      notBuilt: [],
      stoppedAt: [],
    });
  });
});
