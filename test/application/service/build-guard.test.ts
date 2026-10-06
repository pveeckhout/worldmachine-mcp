import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FsPathPolicy } from '../../../src/adapter/out/fs/path-policy.js';
import { WorldMachineBuilder } from '../../../src/adapter/out/worldmachine/world-machine-builder.js';
import { WorldMachineDeviceEditor } from '../../../src/adapter/out/worldmachine/world-machine-device-editor.js';
import { WorldMachineExporter } from '../../../src/adapter/out/worldmachine/world-machine-exporter.js';
import { WorldMachineGraphReader } from '../../../src/adapter/out/worldmachine/world-machine-graph-reader.js';
import { WorldMachineParameterEditor } from '../../../src/adapter/out/worldmachine/world-machine-parameter-editor.js';
import { WorldMachineProcess } from '../../../src/adapter/out/worldmachine/world-machine-process.js';
import { WorldMachineProjectWriter } from '../../../src/adapter/out/worldmachine/world-machine-project-writer.js';
import { WorldMachineSceneEditor } from '../../../src/adapter/out/worldmachine/world-machine-scene-editor.js';
import { WorldMachineSession } from '../../../src/adapter/out/worldmachine/world-machine-session.js';
import { WorldMachineWireEditor } from '../../../src/adapter/out/worldmachine/world-machine-wire-editor.js';
import { AddDeviceService } from '../../../src/application/service/add-device-service.js';
import { BuildProjectService } from '../../../src/application/service/build-project-service.js';
import { ConfigureSceneService } from '../../../src/application/service/configure-scene-service.js';
import { ConnectDevicesService } from '../../../src/application/service/connect-devices-service.js';
import { CreateProjectService } from '../../../src/application/service/create-project-service.js';
import { DeleteDeviceService } from '../../../src/application/service/delete-device-service.js';
import { DisconnectDevicesService } from '../../../src/application/service/disconnect-devices-service.js';
import { ExportOutputsService } from '../../../src/application/service/export-outputs-service.js';
import { GetBuildStatusService } from '../../../src/application/service/get-build-status-service.js';
import { ListDevicesService } from '../../../src/application/service/list-devices-service.js';
import { OpenProjectService } from '../../../src/application/service/open-project-service.js';
import { RedoService } from '../../../src/application/service/redo-service.js';
import { RenameDeviceService } from '../../../src/application/service/rename-device-service.js';
import { SaveProjectService } from '../../../src/application/service/save-project-service.js';
import { SetDeviceEnabledService } from '../../../src/application/service/set-device-enabled-service.js';
import { StopBuildService } from '../../../src/application/service/stop-build-service.js';
import { UndoService } from '../../../src/application/service/undo-service.js';
import { UpdateDeviceParametersService } from '../../../src/application/service/update-device-parameters-service.js';
import type { WorldMachineError } from '../../../src/domain/errors.js';
import { captureLogger, FAKE_WM, fakeEnv, recorder, waitUntil } from '../../support/fake-wm.js';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'build-guard-')));
const sessions: WorldMachineSession[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.shutdown()));
});

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
  return { record, session, policy, reader, writer, devices, builder, exporter };
}

describe('the build guard across the command tools (spec v2a section 4)', () => {
  it('refuses every command tool while a full build runs, keeps the reads working, and lifts after stop_build', async () => {
    const w = wired();
    const { session, policy, reader, writer, devices, builder, exporter } = w;
    const buildProject = new BuildProjectService(session, builder, exporter, reader, policy);
    expect(await buildProject.buildProject({ mode: 'full', waitSeconds: 0 })).toMatchObject({
      state: 'running',
    });
    const sent = w.record.lines().length;
    const wires = new WorldMachineWireEditor(session);
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
    expect((await new GetBuildStatusService(session, builder).getBuildStatus({})).build?.mode).toBe('full');
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
    const buildProject = new BuildProjectService(session, builder, exporter, reader, policy);
    const stopBuild = new StopBuildService(session, builder);
    await writer.saveProject(join(root, 'late.tmd'), true);
    await buildProject.buildProject({ mode: 'full', waitSeconds: 0 });
    expect((await stopBuild.stopBuild({})).stopped).toBe('full');
    expect(await buildProject.buildProject({ mode: 'tiled', waitSeconds: 0 })).toMatchObject({
      state: 'running',
      mode: 'tiled',
    });
    expect((await new GetBuildStatusService(session, builder).getBuildStatus({})).build?.mode).toBe('tiled');
    expect((await stopBuild.stopBuild({})).stopped).toBe('tiled');
  });

  it('stops a build whose start is still waiting for its opening event', async () => {
    const { session, policy, reader, builder, exporter } = wired({ FAKE_WM_START_DELAY_MS: '300' });
    const building = new BuildProjectService(session, builder, exporter, reader, policy).buildProject({
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
    await new BuildProjectService(session, builder, exporter, reader, policy).buildProject({
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
    expect((await new GetBuildStatusService(session, builder).getBuildStatus({})).build).toMatchObject({
      mode: 'unknown',
      startedBy: 'world-machine',
    });
    expect(await failure(new UndoService(session, writer).undo({}))).toMatchObject({
      code: 'REFUSED',
      message: 'A build is running; call stop_build or wait for it to finish',
    });
    expect(await session.buildTracker()?.ended(5_000)).toBe(true);
    expect((await new GetBuildStatusService(session, builder).getBuildStatus({})).build).toBeNull();
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
    expect((await new GetBuildStatusService(session, builder).getBuildStatus({})).build).toMatchObject({
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
      await new BuildProjectService(session, builder, exporter, reader, policy).buildProject({
        mode: 'full',
        waitSeconds: 10,
      }),
    ).toMatchObject({ state: 'finished', mode: 'full' });
    const exported = await new ExportOutputsService(session, exporter, reader, policy).exportOutputs({});
    expect(exported.files).toHaveLength(4);
  });

  it('reports no build when its end arrives inside the build status frame (fact 47)', async () => {
    const { session, policy, reader, builder, exporter } = wired({ FAKE_WM_BUILD_END_ON: 'build status' });
    await new BuildProjectService(session, builder, exporter, reader, policy).buildProject({
      mode: 'full',
      waitSeconds: 0,
    });
    expect(await new GetBuildStatusService(session, builder).getBuildStatus({})).toMatchObject({
      build: null,
      previewRunning: false,
    });
  });
});
