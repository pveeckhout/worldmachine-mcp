#!/usr/bin/env node
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createMcpServer } from './adapter/in/mcp/create-server.js';
import { FsCatalogInstaller } from './adapter/out/fs/fs-catalog-installer.js';
import { FsLocalCatalogs } from './adapter/out/fs/fs-local-catalogs.js';
import { FsPortTypeCorrections } from './adapter/out/fs/fs-port-type-corrections.js';
import { FsGraphTemplateLoader } from './adapter/out/fs/graph-template-loader.js';
import { FsPathPolicy } from './adapter/out/fs/path-policy.js';
import { CAPTURE_MINUTES, PHASE_MINUTES } from './adapter/out/worldmachine/capture/durations.js';
import { WorldMachineCatalogCapturer } from './adapter/out/worldmachine/capture/world-machine-catalog-capturer.js';
import { CatalogRegistry } from './adapter/out/worldmachine/catalog-registry.js';
import { ENUM_CATALOGS } from './adapter/out/worldmachine/enum-options.js';
import { resolveExecutable } from './adapter/out/worldmachine/locator.js';
import { WorldMachineBuildResultReader } from './adapter/out/worldmachine/world-machine-build-result-reader.js';
import { WorldMachineBuilder } from './adapter/out/worldmachine/world-machine-builder.js';
import { WorldMachineDeviceEditor } from './adapter/out/worldmachine/world-machine-device-editor.js';
import { WorldMachineExporter } from './adapter/out/worldmachine/world-machine-exporter.js';
import { WorldMachineGraphReader } from './adapter/out/worldmachine/world-machine-graph-reader.js';
import { WorldMachineGroupEditor } from './adapter/out/worldmachine/world-machine-group-editor.js';
import { WorldMachineParameterEditor } from './adapter/out/worldmachine/world-machine-parameter-editor.js';
import {
  local,
  PORT_TYPE_CATALOGS,
  WorldMachinePortTypes,
} from './adapter/out/worldmachine/world-machine-port-types.js';
import { WorldMachineProcess } from './adapter/out/worldmachine/world-machine-process.js';
import { WorldMachineProjectWriter } from './adapter/out/worldmachine/world-machine-project-writer.js';
import { WorldMachineSceneEditor } from './adapter/out/worldmachine/world-machine-scene-editor.js';
import { WorldMachineSession } from './adapter/out/worldmachine/world-machine-session.js';
import { WorldMachineSnapshotEditor } from './adapter/out/worldmachine/world-machine-snapshot-editor.js';
import { WorldMachineWireEditor } from './adapter/out/worldmachine/world-machine-wire-editor.js';
import { AddDeviceService } from './application/service/add-device-service.js';
import { ApplyGraphService } from './application/service/apply-graph-service.js';
import { BuildProjectService } from './application/service/build-project-service.js';
import { CatalogCaptureService } from './application/service/catalog-capture-service.js';
import { ConfigureSceneService } from './application/service/configure-scene-service.js';
import { ConnectDevicesService } from './application/service/connect-devices-service.js';
import { CreateProjectService } from './application/service/create-project-service.js';
import { CreateSnapshotService } from './application/service/create-snapshot-service.js';
import { DeleteDeviceService } from './application/service/delete-device-service.js';
import { DeleteSnapshotService } from './application/service/delete-snapshot-service.js';
import { DisconnectDevicesService } from './application/service/disconnect-devices-service.js';
import { ExportOutputsService } from './application/service/export-outputs-service.js';
import { GetBuildStatusService } from './application/service/get-build-status-service.js';
import { GetDeviceService } from './application/service/get-device-service.js';
import { GetSceneService } from './application/service/get-scene-service.js';
import { GetStatusService } from './application/service/get-status-service.js';
import { InspectProjectService } from './application/service/inspect-project-service.js';
import { LastFullBuildRecord } from './application/service/last-full-build-record.js';
import { ListDevicesService } from './application/service/list-devices-service.js';
import { ListExportsService } from './application/service/list-exports-service.js';
import { ListGroupsService } from './application/service/list-groups-service.js';
import { ListSnapshotsService } from './application/service/list-snapshots-service.js';
import { OpenProjectService } from './application/service/open-project-service.js';
import { OrganizeDevicesService } from './application/service/organize-devices-service.js';
import { OutputsChecker } from './application/service/outputs-checker.js';
import { PlanGraphService } from './application/service/plan-graph-service.js';
import { RedoService } from './application/service/redo-service.js';
import { RenameDeviceService } from './application/service/rename-device-service.js';
import { RestoreSnapshotService } from './application/service/restore-snapshot-service.js';
import { SaveProjectService } from './application/service/save-project-service.js';
import { SetDeviceBypassedService } from './application/service/set-device-bypassed-service.js';
import { SetDeviceEnabledService } from './application/service/set-device-enabled-service.js';
import { SetGroupEnabledService } from './application/service/set-group-enabled-service.js';
import { StopBuildService } from './application/service/stop-build-service.js';
import { UndoService } from './application/service/undo-service.js';
import { UpdateDeviceParametersService } from './application/service/update-device-parameters-service.js';
import { WireVerdicts } from './application/service/wire-verdicts.js';
import { type Config, loadConfig } from './config.js';
import { portKey } from './domain/catalog.js';
import { createLogger } from './logger.js';
import { createSignalShutdown } from './signal-shutdown.js';

// Below the common 60 s MCP client request timeout, so the server's START_FAILED arrives first; normal startup takes about 4 s (spec fact 6).
const READY_TIMEOUT_MS = 45_000;
const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

let config: Config;
try {
  config = loadConfig(process.env, process.cwd(), homedir());
} catch (error) {
  process.stderr.write(`[worldmachine-mcp] error: ${(error as Error).message}\n`);
  process.exit(1);
}

const logger = createLogger(config.logLevel);
const pathPolicy = new FsPathPolicy(config.allowedRoots);
const templates = new FsGraphTemplateLoader(pathPolicy);
const session = new WorldMachineSession({
  executable: resolveExecutable(config.bin),
  defaultProject: config.defaultProject,
  pathPolicy,
  commandTimeoutMs: config.commandTimeoutMs,
  idleTimeoutMs: config.idleTimeoutMs,
  logger,
  startProcess: (bin, signal, onSpawn) =>
    WorldMachineProcess.start({ bin, readyTimeoutMs: READY_TIMEOUT_MS, logger, signal, onSpawn }),
});
// Local catalogs are read once per process; a file that fails to parse is logged and ignored.
const localCatalogs = new FsLocalCatalogs(config.catalogDir).load();
for (const problem of localCatalogs.problems) logger.warn(`local catalog ignored: ${problem}`);
// Port-types design section 7: the shipped and local catalogs are wired here and in the live tests only (plan decision D3).
// One corrections store, shared by the plans (through portTypes) and the wire verdicts that record into it.
const corrections = new FsPortTypeCorrections(config.catalogDir, logger);
for (const problem of corrections.problems()) logger.warn(`port-type corrections ignored: ${problem}`);
// One live registry for both adapters: an installed catalog answers the next call (register-catalogs-port.ts).
const catalogs = new CatalogRegistry({
  portTypes: [...PORT_TYPE_CATALOGS, ...localCatalogs.portTypeCatalogs.map(local)],
  shippedEnums: ENUM_CATALOGS,
  localEnums: localCatalogs.enumCatalogs,
  problems: localCatalogs.problems,
  catalogDir: config.catalogDir,
});
const portTypes = new WorldMachinePortTypes(session, catalogs, [], corrections);
const reader = new WorldMachineGraphReader(session, catalogs, portTypes);
const writer = new WorldMachineProjectWriter(session);
const devices = new WorldMachineDeviceEditor(session);
const parameters = new WorldMachineParameterEditor(session);
const wires = new WorldMachineWireEditor(session, portTypes);
const verdicts = new WireVerdicts(
  portTypes,
  corrections,
  undefined,
  (report, { build, source, output, input }) => {
    const pair = `${output === undefined ? '?' : portKey(output)} -> ${input === undefined ? '?' : portKey(input)}`;
    const line = `port-type verdict not recorded: build ${build}, ${pair} ${report.verdict} (${source}): ${report.reason}`;
    if (report.reason === 'adaptive device') logger.info(line);
    else logger.warn(line);
  },
);
const scene = new WorldMachineSceneEditor(session);
const builder = new WorldMachineBuilder(session);
const exporter = new WorldMachineExporter(session);
const groups = new WorldMachineGroupEditor(session);
const snapshots = new WorldMachineSnapshotEditor(session);
const results = new WorldMachineBuildResultReader(session);
// Build-status-check design section 6: one record, shared by build_project and get_build_status.
const lastFullBuild = new LastFullBuildRecord();

// One capture service for the three capture tools: it holds the running capture. The session is also the lease source.
const capturer = new WorldMachineCatalogCapturer({ serverVersion: version });
const catalogCapture = new CatalogCaptureService(
  {
    session,
    leases: session,
    capturer,
    transcripts: capturer,
    catalogs,
    installer: new FsCatalogInstaller(config.catalogDir, corrections),
    registry: catalogs,
  },
  { catalogDir: config.catalogDir, serverVersion: version, phaseMinutes: PHASE_MINUTES },
  (name, fields) => logger.info(`catalog capture ${name}: ${JSON.stringify(fields)}`),
);

const handle = serveStdio(() =>
  createMcpServer({
    version,
    logger,
    getStatus: new GetStatusService(session),
    listDevices: new ListDevicesService(session, reader),
    getDevice: new GetDeviceService(session, reader, portTypes, CAPTURE_MINUTES),
    getScene: new GetSceneService(session, reader),
    inspectProject: new InspectProjectService(session, reader),
    openProject: new OpenProjectService(session, pathPolicy, writer),
    createProject: new CreateProjectService(session, writer),
    saveProject: new SaveProjectService(session, pathPolicy, writer),
    undo: new UndoService(session, writer),
    redo: new RedoService(session, writer),
    addDevice: new AddDeviceService(session, devices),
    renameDevice: new RenameDeviceService(session, devices),
    setDeviceEnabled: new SetDeviceEnabledService(session, devices),
    setDeviceBypassed: new SetDeviceBypassedService(session, devices),
    deleteDevice: new DeleteDeviceService(session, devices),
    updateDeviceParameters: new UpdateDeviceParametersService(session, parameters),
    connectDevices: new ConnectDevicesService(session, wires, verdicts),
    disconnectDevices: new DisconnectDevicesService(session, wires),
    configureScene: new ConfigureSceneService(session, scene),
    buildProject: new BuildProjectService(
      session,
      builder,
      exporter,
      reader,
      pathPolicy,
      groups,
      results,
      lastFullBuild,
    ),
    getBuildStatus: new GetBuildStatusService(
      session,
      builder,
      lastFullBuild,
      new OutputsChecker(session, exporter, reader, results),
    ),
    stopBuild: new StopBuildService(session, builder),
    listExports: new ListExportsService(session, exporter, reader, pathPolicy),
    exportOutputs: new ExportOutputsService(session, exporter, reader, pathPolicy),
    listSnapshots: new ListSnapshotsService(session, snapshots),
    createSnapshot: new CreateSnapshotService(session, snapshots),
    restoreSnapshot: new RestoreSnapshotService(session, snapshots),
    deleteSnapshot: new DeleteSnapshotService(session, snapshots),
    organizeDevices: new OrganizeDevicesService(session, devices),
    listGroups: new ListGroupsService(session, groups),
    setGroupEnabled: new SetGroupEnabledService(session, groups),
    planGraph: new PlanGraphService(session, reader, portTypes, templates, CAPTURE_MINUTES),
    applyGraph: new ApplyGraphService(
      session,
      reader,
      devices,
      wires,
      parameters,
      snapshots,
      portTypes,
      scene,
      templates,
      verdicts,
    ),
    captureCatalog: catalogCapture,
    getCatalogCaptureStatus: catalogCapture,
    cancelCatalogCapture: catalogCapture,
    currentSession: () => session.status().session,
  }),
);

// The SDK client ends stdin, waits 2 s, sends SIGTERM, waits 2 s, then SIGKILLs this process (spec section 9).
const STDIN_END_BUDGET = { drainMs: 500, graceMs: 1_000, termMs: 300 } as const;
const KILL_BOUND_MS = 1_000;
const SIGNAL_BUDGET = { drainMs: 0, graceMs: 500, termMs: 0 } as const;

const shutdown = createSignalShutdown({
  stop: async (reason) => {
    await session.shutdown(reason === 'stdin closed' ? STDIN_END_BUDGET : SIGNAL_BUDGET);
    await handle.close();
  },
  kill: () => session.kill(),
  exit: (code) => process.exit(code),
  logger,
  boundMs: KILL_BOUND_MS,
});

process.stdin.once('end', () => shutdown.trigger('stdin closed'));
process.on('SIGINT', () => shutdown.trigger('SIGINT'));
process.on('SIGTERM', () => shutdown.trigger('SIGTERM'));
