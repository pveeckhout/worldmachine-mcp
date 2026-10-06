#!/usr/bin/env node
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createMcpServer } from './adapter/in/mcp/create-server.js';
import { FsPathPolicy } from './adapter/out/fs/path-policy.js';
import { resolveExecutable } from './adapter/out/worldmachine/locator.js';
import { WorldMachineBuilder } from './adapter/out/worldmachine/world-machine-builder.js';
import { WorldMachineDeviceEditor } from './adapter/out/worldmachine/world-machine-device-editor.js';
import { WorldMachineExporter } from './adapter/out/worldmachine/world-machine-exporter.js';
import { WorldMachineGraphReader } from './adapter/out/worldmachine/world-machine-graph-reader.js';
import { WorldMachineParameterEditor } from './adapter/out/worldmachine/world-machine-parameter-editor.js';
import { WorldMachineProcess } from './adapter/out/worldmachine/world-machine-process.js';
import { WorldMachineProjectWriter } from './adapter/out/worldmachine/world-machine-project-writer.js';
import { WorldMachineSceneEditor } from './adapter/out/worldmachine/world-machine-scene-editor.js';
import { WorldMachineSession } from './adapter/out/worldmachine/world-machine-session.js';
import { WorldMachineWireEditor } from './adapter/out/worldmachine/world-machine-wire-editor.js';
import { AddDeviceService } from './application/service/add-device-service.js';
import { BuildProjectService } from './application/service/build-project-service.js';
import { ConfigureSceneService } from './application/service/configure-scene-service.js';
import { ConnectDevicesService } from './application/service/connect-devices-service.js';
import { CreateProjectService } from './application/service/create-project-service.js';
import { DeleteDeviceService } from './application/service/delete-device-service.js';
import { DisconnectDevicesService } from './application/service/disconnect-devices-service.js';
import { ExportOutputsService } from './application/service/export-outputs-service.js';
import { GetBuildStatusService } from './application/service/get-build-status-service.js';
import { GetDeviceService } from './application/service/get-device-service.js';
import { GetSceneService } from './application/service/get-scene-service.js';
import { GetStatusService } from './application/service/get-status-service.js';
import { InspectProjectService } from './application/service/inspect-project-service.js';
import { ListDevicesService } from './application/service/list-devices-service.js';
import { ListExportsService } from './application/service/list-exports-service.js';
import { OpenProjectService } from './application/service/open-project-service.js';
import { RedoService } from './application/service/redo-service.js';
import { RenameDeviceService } from './application/service/rename-device-service.js';
import { SaveProjectService } from './application/service/save-project-service.js';
import { SetDeviceEnabledService } from './application/service/set-device-enabled-service.js';
import { StopBuildService } from './application/service/stop-build-service.js';
import { UndoService } from './application/service/undo-service.js';
import { UpdateDeviceParametersService } from './application/service/update-device-parameters-service.js';
import { type Config, loadConfig } from './config.js';
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
const reader = new WorldMachineGraphReader(session);
const writer = new WorldMachineProjectWriter(session);
const devices = new WorldMachineDeviceEditor(session);
const parameters = new WorldMachineParameterEditor(session);
const wires = new WorldMachineWireEditor(session);
const scene = new WorldMachineSceneEditor(session);
const builder = new WorldMachineBuilder(session);
const exporter = new WorldMachineExporter(session);

const handle = serveStdio(() =>
  createMcpServer({
    version,
    logger,
    getStatus: new GetStatusService(session),
    listDevices: new ListDevicesService(session, reader),
    getDevice: new GetDeviceService(session, reader),
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
    deleteDevice: new DeleteDeviceService(session, devices),
    updateDeviceParameters: new UpdateDeviceParametersService(session, parameters),
    connectDevices: new ConnectDevicesService(session, wires),
    disconnectDevices: new DisconnectDevicesService(session, wires),
    configureScene: new ConfigureSceneService(session, scene),
    buildProject: new BuildProjectService(session, builder, exporter, reader, pathPolicy),
    getBuildStatus: new GetBuildStatusService(session, builder),
    stopBuild: new StopBuildService(session, builder),
    listExports: new ListExportsService(session, exporter, reader, pathPolicy),
    exportOutputs: new ExportOutputsService(session, exporter, reader, pathPolicy),
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
