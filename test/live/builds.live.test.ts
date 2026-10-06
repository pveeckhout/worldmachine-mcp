import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { FsPathPolicy } from '../../src/adapter/out/fs/path-policy.js';
import { resolveExecutable } from '../../src/adapter/out/worldmachine/locator.js';
import { WorldMachineBuilder } from '../../src/adapter/out/worldmachine/world-machine-builder.js';
import { WorldMachineExporter } from '../../src/adapter/out/worldmachine/world-machine-exporter.js';
import { WorldMachineGraphReader } from '../../src/adapter/out/worldmachine/world-machine-graph-reader.js';
import { WorldMachineGroupEditor } from '../../src/adapter/out/worldmachine/world-machine-group-editor.js';
import { WorldMachineProcess } from '../../src/adapter/out/worldmachine/world-machine-process.js';
import { WorldMachineProjectWriter } from '../../src/adapter/out/worldmachine/world-machine-project-writer.js';
import { WorldMachineSceneEditor } from '../../src/adapter/out/worldmachine/world-machine-scene-editor.js';
import { WorldMachineSession } from '../../src/adapter/out/worldmachine/world-machine-session.js';
import { BuildProjectService } from '../../src/application/service/build-project-service.js';
import { ConfigureSceneService } from '../../src/application/service/configure-scene-service.js';
import { ExportOutputsService } from '../../src/application/service/export-outputs-service.js';
import { GetBuildStatusService } from '../../src/application/service/get-build-status-service.js';
import { ListExportsService } from '../../src/application/service/list-exports-service.js';
import { StopBuildService } from '../../src/application/service/stop-build-service.js';
import { captureLogger } from '../support/fake-wm.js';

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
  const buildProject = new BuildProjectService(
    session,
    builder,
    exporter,
    reader,
    policy,
    new WorldMachineGroupEditor(session),
  );
  const stopBuild = new StopBuildService(session, builder);
  const buildStatus = new GetBuildStatusService(session, builder);
  const listExports = new ListExportsService(session, exporter, reader, policy);
  const exportOutputs = new ExportOutputsService(session, exporter, reader, policy);
  const configureScene = new ConfigureSceneService(session, scene);
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
});
