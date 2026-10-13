import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { FsPathPolicy } from '../../src/adapter/out/fs/path-policy.js';
import { buildCommand } from '../../src/adapter/out/worldmachine/command-builder.js';
import { resolveExecutable } from '../../src/adapter/out/worldmachine/locator.js';
import { throwIfFailed } from '../../src/adapter/out/worldmachine/raw-response.js';
import { WorldMachineBuildResultReader } from '../../src/adapter/out/worldmachine/world-machine-build-result-reader.js';
import { WorldMachineBuilder } from '../../src/adapter/out/worldmachine/world-machine-builder.js';
import { WorldMachineDeviceEditor } from '../../src/adapter/out/worldmachine/world-machine-device-editor.js';
import { WorldMachineExporter } from '../../src/adapter/out/worldmachine/world-machine-exporter.js';
import { WorldMachineGraphReader } from '../../src/adapter/out/worldmachine/world-machine-graph-reader.js';
import { WorldMachineGroupEditor } from '../../src/adapter/out/worldmachine/world-machine-group-editor.js';
import { WorldMachineProcess } from '../../src/adapter/out/worldmachine/world-machine-process.js';
import { WorldMachineProjectWriter } from '../../src/adapter/out/worldmachine/world-machine-project-writer.js';
import { WorldMachineSceneEditor } from '../../src/adapter/out/worldmachine/world-machine-scene-editor.js';
import { WorldMachineSession } from '../../src/adapter/out/worldmachine/world-machine-session.js';
import { WorldMachineWireEditor } from '../../src/adapter/out/worldmachine/world-machine-wire-editor.js';
import { BuildProjectService } from '../../src/application/service/build-project-service.js';
import { ConfigureSceneService } from '../../src/application/service/configure-scene-service.js';
import { ExportOutputsService } from '../../src/application/service/export-outputs-service.js';
import { GetBuildStatusService } from '../../src/application/service/get-build-status-service.js';
import { LastFullBuildRecord } from '../../src/application/service/last-full-build-record.js';
import { ListExportsService } from '../../src/application/service/list-exports-service.js';
import { OutputsChecker } from '../../src/application/service/outputs-checker.js';
import { StopBuildService } from '../../src/application/service/stop-build-service.js';
import { NOT_BUILT_HINT } from '../../src/domain/build-result.js';
import { captureLogger, waitUntil } from '../support/fake-wm.js';

const executable = resolveExecutable(process.env.WORLD_MACHINE_BIN ?? null);
const LIVE = process.env.WM_LIVE === '1' && executable !== null;

describe.skipIf(!LIVE)('live World Machine builds and exports (spec v2a section 8)', () => {
  const logger = captureLogger();
  // describe.skipIf still runs this body at collection, so only create the directory when the run is live.
  const liveRoot = LIVE ? mkdtempSync(join(tmpdir(), 'wm-live-builds-')) : '';
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
  const scene = new WorldMachineSceneEditor(session);
  const builder = new WorldMachineBuilder(session);
  const exporter = new WorldMachineExporter(session);
  const lastFullBuild = new LastFullBuildRecord();
  const buildProject = new BuildProjectService(
    session,
    builder,
    exporter,
    reader,
    policy,
    new WorldMachineGroupEditor(session),
    new WorldMachineBuildResultReader(session),
    lastFullBuild,
  );
  const stopBuild = new StopBuildService(session, builder);
  const buildStatus = new GetBuildStatusService(
    session,
    builder,
    lastFullBuild,
    new OutputsChecker(session, exporter, reader, new WorldMachineBuildResultReader(session)),
  );
  const listExports = new ListExportsService(session, exporter, reader, policy);
  const exportOutputs = new ExportOutputsService(session, exporter, reader, policy);
  const configureScene = new ConfigureSceneService(session, scene);
  const devices = new WorldMachineDeviceEditor(session);
  const wires = new WorldMachineWireEditor(session);
  const startedAt = Date.now();
  // Close-then-quit always runs, so the licence seat returns (spec fact 20); a build still running is stopped first.
  afterAll(async () => {
    try {
      await session.shutdown();
    } finally {
      rmSync(liveRoot, { recursive: true, force: true });
    }
  }, 60_000);

  it('refuses export_outputs on a project never saved and writes nothing (fact 50)', async () => {
    await session.ensureRunning();
    await writer.createProject();
    await scene.configureScene({ resolution: 257 });
    await expect(exportOutputs.exportOutputs({})).rejects.toMatchObject({ code: 'REFUSED' });
    const documents = join(homedir(), 'Documents', 'WorldMachine');
    const written = existsSync(documents)
      ? readdirSync(documents).filter((name) => statSync(join(documents, name)).mtimeMs >= startedAt)
      : [];
    expect(written).toEqual([]);
  }, 180_000);

  it('runs a preview to its end', async () => {
    expect(await buildProject.buildProject({ mode: 'preview', waitSeconds: 120 })).toMatchObject({
      state: 'finished',
      mode: 'preview',
    });
  }, 180_000);

  it('lists the default exports against the saved project', async () => {
    await writer.saveProject(join(liveRoot, 'builds.tmd'), false);
    const view = await listExports.listExports({});
    expect(view.projectFolder).toBe(liveRoot);
    expect(view.targets.map((target) => target.device)).toContain('Height Output');
    expect(view.targets.every((target) => target.allowed)).toBe(true);
  }, 60_000);

  it('exports after a full build, with the files on disk and the Material Output note (fact 50)', async () => {
    expect(await buildProject.buildProject({ mode: 'full', waitSeconds: 300 })).toMatchObject({
      state: 'finished',
    });
    const view = await exportOutputs.exportOutputs({});
    expect(view.files.length).toBeGreaterThan(0);
    for (const file of view.files.filter((path) => !path.includes('Material Output'))) {
      expect(statSync(file).isFile(), file).toBe(true);
    }
    expect(view.note).toBeDefined();
    expect(readdirSync(liveRoot).filter((name) => name.endsWith('_roughness.png'))).toHaveLength(1);
  }, 360_000);

  it('runs a tiled build that writes tiles into the project folder (fact 48)', async () => {
    const view = await buildProject.buildProject({ mode: 'tiled', waitSeconds: 300 });
    expect(view).toMatchObject({ state: 'finished', mode: 'tiled', outputFolders: [liveRoot] });
    expect(readdirSync(liveRoot).some((name) => name.includes('_x0_y0'))).toBe(true);
  }, 360_000);

  it('keeps read tools working during a 4097 build, refuses edits, and stops it (facts 44, 46)', async () => {
    await scene.configureScene({ resolution: 4097 });
    expect(await buildProject.buildProject({ mode: 'full', waitSeconds: 0 })).toMatchObject({
      state: 'running',
    });
    expect((await reader.listDevices()).length).toBeGreaterThan(0);
    expect((await buildStatus.getBuildStatus({})).build).toMatchObject({ mode: 'full', startedBy: 'server' });
    await expect(configureScene.configureScene({ resolution: 257 })).rejects.toMatchObject({
      code: 'REFUSED',
    });
    expect((await stopBuild.stopBuild({})).stopped).toBe('full');
    expect((await buildStatus.getBuildStatus({})).build).toBeNull();
  }, 120_000);

  it('reports the output a console-added River did not build, and a plain graph as built (build-not-built section 8)', async () => {
    await session.ensureRunning();
    const blank = async () => {
      throwIfFailed(await session.executeOne('project new blank force'));
      await scene.configureScene({ resolution: 513 });
    };
    // raw/build-not-built-timing.txt l.41-42: the File Output's filename, inside the live root. A full build writes no
    // file (fact 48) and a new File Output's exportAlways is false (raw/v6b-param-set.txt l.43).
    const filename = async (id: number, file: string) =>
      throwIfFailed(
        await session.executeOne(buildCommand(['param', 'set', `#${id}.filename`], join(liveRoot, file))),
      );
    // l.1-46: Gradient into River into File Output.
    await blank();
    const gradient = await devices.addDevice('Gradient');
    const river = await devices.addDevice('River');
    const output = await devices.addDevice('File Output');
    await wires.connect({ device: `#${gradient.id}` }, { device: `#${river.id}`, port: 1 });
    await wires.connect({ device: `#${river.id}` }, { device: `#${output.id}` });
    await filename(output.id, 'river-height.png');
    expect(await buildProject.buildProject({ mode: 'full', waitSeconds: 120 })).toMatchObject({
      state: 'finished',
      outputsBuilt: false,
      notBuilt: [{ id: output.id, name: 'Height Output' }],
      stoppedAt: [{ id: river.id, name: 'River', type: 'River', enabled: true, bypassed: false }],
      hint: NOT_BUILT_HINT,
    });
    // l.119-149: Gradient into File Output.
    await blank();
    const plain = await devices.addDevice('Gradient');
    const plainOutput = await devices.addDevice('File Output');
    await wires.connect({ device: `#${plain.id}` }, { device: `#${plainOutput.id}` });
    await filename(plainOutput.id, 'plain-height.png');
    const built = await buildProject.buildProject({ mode: 'full', waitSeconds: 120 });
    expect(built).toMatchObject({ state: 'finished', outputsBuilt: true, notBuilt: [], stoppedAt: [] });
    expect(built).not.toHaveProperty('hint');
    expect(built).not.toHaveProperty('outputsCheckError');
  }, 360_000);

  it('reports in get_build_status the output a River did not build once a full build that outlived the wait ends (build-status-check section 7)', async () => {
    await session.ensureRunning();
    throwIfFailed(await session.executeOne('project new blank force'));
    await scene.configureScene({ resolution: 513 });
    // raw/build-not-built-timing.txt l.1-46: Gradient into River into File Output, its filename inside the live root.
    const gradient = await devices.addDevice('Gradient');
    const river = await devices.addDevice('River');
    const output = await devices.addDevice('File Output');
    await wires.connect({ device: `#${gradient.id}` }, { device: `#${river.id}`, port: 1 });
    await wires.connect({ device: `#${river.id}` }, { device: `#${output.id}` });
    throwIfFailed(
      await session.executeOne(
        buildCommand(['param', 'set', `#${output.id}.filename`], join(liveRoot, 'outlived-height.png')),
      ),
    );
    expect(await buildProject.buildProject({ mode: 'full', waitSeconds: 0 })).toMatchObject({
      state: 'running',
      mode: 'full',
    });
    await waitUntil(() => builder.last()?.state === 'ended', 120_000);
    expect((await buildStatus.getBuildStatus({})).lastFullBuild).toEqual({
      startedAt: new Date(builder.last()?.startedAt ?? 0).toISOString(),
      outputsBuilt: false,
      notBuilt: [{ id: output.id, name: 'Height Output' }],
      stoppedAt: [{ id: river.id, name: 'River', type: 'River', enabled: true, bypassed: false }],
      hint: NOT_BUILT_HINT,
    });
  }, 360_000);
});
