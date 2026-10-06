import { McpServer, type ServerContext } from '@modelcontextprotocol/server';
import type { AddDeviceCommandPort } from '../../../application/port/in/command/add-device-command.js';
import type { BuildProjectCommandPort } from '../../../application/port/in/command/build-project-command.js';
import type {
  ConfigureSceneCommand,
  ConfigureSceneCommandPort,
} from '../../../application/port/in/command/configure-scene-command.js';
import type { ConnectDevicesCommandPort } from '../../../application/port/in/command/connect-devices-command.js';
import type { CreateProjectCommandPort } from '../../../application/port/in/command/create-project-command.js';
import type { DeleteDeviceCommandPort } from '../../../application/port/in/command/delete-device-command.js';
import type { DisconnectDevicesCommandPort } from '../../../application/port/in/command/disconnect-devices-command.js';
import type { ExportOutputsCommandPort } from '../../../application/port/in/command/export-outputs-command.js';
import type { OpenProjectCommandPort } from '../../../application/port/in/command/open-project-command.js';
import type { RedoCommandPort } from '../../../application/port/in/command/redo-command.js';
import type { RenameDeviceCommandPort } from '../../../application/port/in/command/rename-device-command.js';
import type { SaveProjectCommandPort } from '../../../application/port/in/command/save-project-command.js';
import type { SetDeviceEnabledCommandPort } from '../../../application/port/in/command/set-device-enabled-command.js';
import type { StopBuildCommandPort } from '../../../application/port/in/command/stop-build-command.js';
import type { UndoCommandPort } from '../../../application/port/in/command/undo-command.js';
import type { UpdateDeviceParametersCommandPort } from '../../../application/port/in/command/update-device-parameters-command.js';
import type { GetBuildStatusQueryPort } from '../../../application/port/in/query/get-build-status-query.js';
import type { GetDeviceQueryPort } from '../../../application/port/in/query/get-device-query.js';
import type { GetSceneQueryPort } from '../../../application/port/in/query/get-scene-query.js';
import type { GetStatusQueryPort } from '../../../application/port/in/query/get-status-query.js';
import type { InspectProjectQueryPort } from '../../../application/port/in/query/inspect-project-query.js';
import type { ListDevicesQueryPort } from '../../../application/port/in/query/list-devices-query.js';
import type { ListExportsQueryPort } from '../../../application/port/in/query/list-exports-query.js';
import { WorldMachineError } from '../../../domain/errors.js';
import type { WireEndpoint } from '../../../domain/graph-edit.js';
import type { SessionSummary } from '../../../domain/session.js';
import type { Logger } from '../../../logger.js';
import {
  addDeviceInputSchema,
  addDeviceViewSchema,
  buildProjectInputSchema,
  buildProjectViewSchema,
  buildStatusViewSchema,
  configureSceneInputSchema,
  configureSceneViewSchema,
  connectDevicesViewSchema,
  createProjectInputSchema,
  deleteDeviceInputSchema,
  deleteDeviceViewSchema,
  deviceListViewSchema,
  deviceViewSchema,
  disconnectDevicesViewSchema,
  exportOutputsViewSchema,
  getDeviceInputSchema,
  listDevicesInputSchema,
  listExportsViewSchema,
  noInputSchema,
  openProjectInputSchema,
  projectCommandViewSchema,
  projectViewSchema,
  renameDeviceInputSchema,
  renameDeviceViewSchema,
  saveProjectInputSchema,
  sceneViewSchema,
  setDeviceEnabledInputSchema,
  setDeviceEnabledViewSchema,
  statusViewSchema,
  stopBuildViewSchema,
  updateDeviceParametersInputSchema,
  updateDeviceParametersViewSchema,
  wireInputSchema,
} from './schemas.js';
import { failure, success } from './tool-result.js';

export type McpDependencies = {
  readonly version: string;
  readonly getStatus: GetStatusQueryPort;
  readonly listDevices: ListDevicesQueryPort;
  readonly getDevice: GetDeviceQueryPort;
  readonly getScene: GetSceneQueryPort;
  readonly inspectProject: InspectProjectQueryPort;
  readonly openProject: OpenProjectCommandPort;
  readonly createProject: CreateProjectCommandPort;
  readonly saveProject: SaveProjectCommandPort;
  readonly undo: UndoCommandPort;
  readonly redo: RedoCommandPort;
  readonly addDevice: AddDeviceCommandPort;
  readonly renameDevice: RenameDeviceCommandPort;
  readonly setDeviceEnabled: SetDeviceEnabledCommandPort;
  readonly deleteDevice: DeleteDeviceCommandPort;
  readonly updateDeviceParameters: UpdateDeviceParametersCommandPort;
  readonly connectDevices: ConnectDevicesCommandPort;
  readonly disconnectDevices: DisconnectDevicesCommandPort;
  readonly configureScene: ConfigureSceneCommandPort;
  readonly buildProject: BuildProjectCommandPort;
  readonly getBuildStatus: GetBuildStatusQueryPort;
  readonly stopBuild: StopBuildCommandPort;
  readonly listExports: ListExportsQueryPort;
  readonly exportOutputs: ExportOutputsCommandPort;
  readonly currentSession: () => SessionSummary;
  readonly logger: Logger;
};

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
const COMMAND = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;
const IDEMPOTENT_COMMAND = { ...COMMAND, idempotentHint: true } as const;
const DESTRUCTIVE = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
} as const;

export function createMcpServer(deps: McpDependencies): McpServer {
  const server = new McpServer(
    { name: 'worldmachine-mcp', version: deps.version },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    'get_world_machine_status',
    {
      title: 'World Machine status',
      description:
        'Report whether World Machine is configured and running, its build, and which project is active. Never starts World Machine.',
      inputSchema: noInputSchema,
      outputSchema: statusViewSchema,
      annotations: READ_ONLY,
    },
    () => respond(deps, 'get_world_machine_status', () => deps.getStatus.getStatus({})),
  );

  server.registerTool(
    'list_devices',
    {
      title: 'List devices',
      description:
        'List the devices in the active World Machine project with their stable ids (#n), names, and kinds. Bypass is omitted for disabled devices (World Machine hides it there); get_device reports it. Starts World Machine if it is not running.',
      inputSchema: listDevicesInputSchema,
      outputSchema: deviceListViewSchema,
      annotations: READ_ONLY,
    },
    ({ filter }) =>
      respond(deps, 'list_devices', () =>
        deps.listDevices.listDevices(filter === undefined ? {} : { filter }),
      ),
  );

  server.registerTool(
    'get_device',
    {
      title: 'Get device',
      description:
        'Show one device: type, enabled and bypass state, every parameter with its current value as World Machine displays it, and its input and output connections.',
      inputSchema: getDeviceInputSchema,
      outputSchema: deviceViewSchema,
      annotations: READ_ONLY,
    },
    ({ device }) => respond(deps, 'get_device', () => deps.getDevice.getDevice({ device })),
  );

  server.registerTool(
    'get_scene',
    {
      title: 'Get scene',
      description: 'Show the current scene: name, centre, size in km, render resolution, and lock state.',
      inputSchema: noInputSchema,
      outputSchema: sceneViewSchema,
      annotations: READ_ONLY,
    },
    () => respond(deps, 'get_scene', () => deps.getScene.getScene({})),
  );

  server.registerTool(
    'inspect_project',
    {
      title: 'Inspect project',
      description: 'Summarise the active project: current scene, all scenes, all devices, and device groups.',
      inputSchema: noInputSchema,
      outputSchema: projectViewSchema,
      annotations: READ_ONLY,
    },
    () => respond(deps, 'inspect_project', () => deps.inspectProject.inspectProject({})),
  );

  server.registerTool(
    'open_project',
    {
      title: 'Open project',
      description:
        'Open an existing .tmd project. Refuses if the current project has unsaved changes unless discard_unsaved is true.',
      inputSchema: openProjectInputSchema,
      outputSchema: projectCommandViewSchema,
      annotations: COMMAND,
    },
    ({ path, discard_unsaved }) =>
      respond(deps, 'open_project', () =>
        deps.openProject.openProject({ path, discardUnsaved: discard_unsaved }),
      ),
  );

  server.registerTool(
    'create_project',
    {
      title: 'Create project',
      description:
        "Replace the current project with World Machine's default new project. Refuses if there are unsaved changes unless discard_unsaved is true.",
      inputSchema: createProjectInputSchema,
      outputSchema: projectCommandViewSchema,
      annotations: COMMAND,
    },
    ({ discard_unsaved }) =>
      respond(deps, 'create_project', () =>
        deps.createProject.createProject({ discardUnsaved: discard_unsaved }),
      ),
  );

  server.registerTool(
    'save_project',
    {
      title: 'Save project',
      description:
        'Save the project to a .tmd file. Never replaces an existing file unless overwrite is true. The save is checked on disk, because World Machine can report saves it did not perform.',
      inputSchema: saveProjectInputSchema,
      outputSchema: projectCommandViewSchema,
      annotations: DESTRUCTIVE,
    },
    ({ path, overwrite }) =>
      respond(deps, 'save_project', () =>
        deps.saveProject.saveProject(path === undefined ? { overwrite } : { path, overwrite }),
      ),
  );

  server.registerTool(
    'undo',
    {
      title: 'Undo',
      description:
        'Undo the last change in World Machine. World Machine does not report whether there was anything to undo; inspect the project to see the effect.',
      inputSchema: noInputSchema,
      outputSchema: projectCommandViewSchema,
      annotations: COMMAND,
    },
    () => respond(deps, 'undo', () => deps.undo.undo({})),
  );

  server.registerTool(
    'redo',
    {
      title: 'Redo',
      description:
        'Redo the last undone change in World Machine. World Machine does not report whether there was anything to redo; inspect the project to see the effect.',
      inputSchema: noInputSchema,
      outputSchema: projectCommandViewSchema,
      annotations: COMMAND,
    },
    () => respond(deps, 'redo', () => deps.redo.redo({})),
  );

  server.registerTool(
    'add_device',
    {
      title: 'Add device',
      description:
        'Add a device of an exact World Machine type (for example Gradient, Erosion, or File Output) and optionally name it. Returns its stable id (#n). World Machine names new devices after their type and does not make names unique. Names that list_devices could not show unambiguously are refused: leading or trailing spaces, a trailing [disabled] or [bypassed], trailing parenthesised text after two or more spaces, #<n>, or more than 23 characters.',
      inputSchema: addDeviceInputSchema,
      outputSchema: addDeviceViewSchema,
      annotations: COMMAND,
    },
    ({ type, name }) =>
      respond(deps, 'add_device', () =>
        deps.addDevice.addDevice(name === undefined ? { type } : { type, name }),
      ),
  );

  server.registerTool(
    'rename_device',
    {
      title: 'Rename device',
      description:
        'Rename a device, referenced by name or #<n>. The result shows the name World Machine reports afterwards. Names that list_devices could not show unambiguously are refused: leading or trailing spaces, a trailing [disabled] or [bypassed], trailing parenthesised text after two or more spaces, #<n>, or more than 23 characters.',
      inputSchema: renameDeviceInputSchema,
      outputSchema: renameDeviceViewSchema,
      annotations: IDEMPOTENT_COMMAND,
    },
    ({ device, name }) =>
      respond(deps, 'rename_device', () => deps.renameDevice.renameDevice({ device, name })),
  );

  server.registerTool(
    'set_device_enabled',
    {
      title: 'Enable or disable device',
      description:
        'Enable or disable a device. World Machine prints the same confirmation whether or not the state changed, so the device is read back: enabled is the state World Machine reports afterwards, and changed tells whether it differs from before. Bypass cannot be set.',
      inputSchema: setDeviceEnabledInputSchema,
      outputSchema: setDeviceEnabledViewSchema,
      annotations: IDEMPOTENT_COMMAND,
    },
    ({ device, enabled }) =>
      respond(deps, 'set_device_enabled', () => deps.setDeviceEnabled.setDeviceEnabled({ device, enabled })),
  );

  server.registerTool(
    'update_device_parameters',
    {
      title: 'Update device parameters',
      description:
        "Set one or more parameters of one device; give at least one. Every name and value is checked against the device's parameter list first; if any is invalid, nothing is set. Names are case-sensitive. Numeric values are World Machine's internal values, not the units it displays: setting a width of 0.5 can read back as 4 km. This tool takes floats and integers in plain decimal notation, enum options as their 0-based index, and booleans as true or false (or 1, 0, yes, off); World Machine itself would also take exponent forms, enum labels, and other boolean words, which this tool refuses so that each value is checked before it is sent. Action, other, and filename parameters and exportAlways cannot be set (filename would let World Machine write outside the allowed roots, and exportAlways makes every full build write files). Each item reports whether World Machine applied or rejected it and the value read back afterwards, in display units. There is no automatic rollback; undo reverts one parameter per call.",
      inputSchema: updateDeviceParametersInputSchema,
      outputSchema: updateDeviceParametersViewSchema,
      annotations: IDEMPOTENT_COMMAND,
    },
    ({ device, parameters }) =>
      respond(deps, 'update_device_parameters', () =>
        deps.updateDeviceParameters.updateDeviceParameters({ device, parameters }),
      ),
  );

  server.registerTool(
    'connect_devices',
    {
      title: 'Connect devices',
      description:
        'Connect an output port of the source device to an input port of the destination device. Ports are 1-based and default to 1. A wire that already exists is left alone (created: false); when several devices share the source name and the input is already wired from that name, the call is refused with a hint to rename one of them. World Machine refuses an input that is already connected to another output; disconnect that wire first.',
      inputSchema: wireInputSchema,
      outputSchema: connectDevicesViewSchema,
      annotations: IDEMPOTENT_COMMAND,
    },
    ({ source, source_port, destination, destination_port }) =>
      respond(deps, 'connect_devices', () =>
        deps.connectDevices.connectDevices({
          source: endpoint(source, source_port),
          destination: endpoint(destination, destination_port),
        }),
      ),
  );

  server.registerTool(
    'disconnect_devices',
    {
      title: 'Disconnect devices',
      description:
        "Remove the wire from the source device's output port to the destination device's input port (ports default to 1). World Machine confirms a disconnection even when no wire existed, so the destination's connections are read before and after: removed is false when there was no such wire, and then nothing is sent.",
      inputSchema: wireInputSchema,
      outputSchema: disconnectDevicesViewSchema,
      annotations: IDEMPOTENT_COMMAND,
    },
    ({ source, source_port, destination, destination_port }) =>
      respond(deps, 'disconnect_devices', () =>
        deps.disconnectDevices.disconnectDevices({
          source: endpoint(source, source_port),
          destination: endpoint(destination, destination_port),
        }),
      ),
  );

  server.registerTool(
    'configure_scene',
    {
      title: 'Configure scene',
      description:
        "Change the current scene's name, centre (origin_km), size (size_km), or render resolution; give at least one. Returns the scene as World Machine reports it afterwards. If World Machine rejects one setting, the others in the same call may already be applied; undo reverts one setting per call.",
      inputSchema: configureSceneInputSchema,
      outputSchema: configureSceneViewSchema,
      annotations: IDEMPOTENT_COMMAND,
    },
    (input) =>
      respond(deps, 'configure_scene', () => deps.configureScene.configureScene(sceneChanges(input))),
  );

  server.registerTool(
    'delete_device',
    {
      title: 'Delete device',
      description:
        'Delete a device from the project, referenced by name or #<n>. Its wires are removed with it; undo restores the device under its old id, with its wires.',
      inputSchema: deleteDeviceInputSchema,
      outputSchema: deleteDeviceViewSchema,
      annotations: DESTRUCTIVE,
    },
    ({ device }) => respond(deps, 'delete_device', () => deps.deleteDevice.deleteDevice({ device })),
  );

  server.registerTool(
    'build_project',
    {
      title: 'Build project',
      description:
        "Build the project in World Machine and wait up to wait_seconds (default 60, at most 600) for the build to end. preview runs World Machine's quick preview; full builds every device at the scene resolution and writes no files; tiled runs the tiled build set up in the World Machine window and writes every output as tiles next to its export path, overwriting files of the same name without asking. A tiled build checks its targets itself and is refused unless the project was saved and every output folder exists inside the allowed roots; it also refuses a file name template that uses <res> in a folder name, and one with an unknown template token, whose value the server cannot know. A full build checks the same way when an output has exportAlways set (or its setting cannot be read), because such an output may be written on every full build. If the wait ends first, state is running and the build continues: check get_build_status, or call stop_build. A build ended by stop_build is reported as finished. While a full or tiled build runs, every other change tool is refused. World Machine does not report failed builds, so finished means only that the build ended.",
      inputSchema: buildProjectInputSchema,
      outputSchema: buildProjectViewSchema,
      annotations: DESTRUCTIVE,
    },
    ({ mode, wait_seconds }, ctx) =>
      respond(deps, 'build_project', () =>
        deps.buildProject.buildProject({
          mode,
          waitSeconds: wait_seconds,
          signal: ctx.mcpReq.signal,
          ...progressOf(ctx, wait_seconds, deps.logger),
        }),
      ),
  );

  server.registerTool(
    'get_build_status',
    {
      title: 'Build status',
      description:
        'Report the running full or tiled build (mode, seconds since it started, and whether this server or the World Machine window started it) and whether a preview is running. A build started in the World Machine window shows only if World Machine prints its build events to the console; its mode is unknown until it shows as a full build (a tiled one stays unknown). Never starts World Machine.',
      inputSchema: noInputSchema,
      outputSchema: buildStatusViewSchema,
      annotations: READ_ONLY,
    },
    () => respond(deps, 'get_build_status', () => deps.getBuildStatus.getBuildStatus({})),
  );

  server.registerTool(
    'stop_build',
    {
      title: 'Stop build',
      description:
        'Stop the running build. A full, tiled, or unknown build is stopped and waited for, up to 10 s; otherwise a running preview is stopped. stopped names what was stopped, or is null when nothing was running (then nothing is sent). A stopped tiled build may already have written tiles. A run that shows no end within 10 s fails the call with WM_COMMAND_FAILED; a build started in the World Machine window is then no longer tracked, so the change tools work again.',
      inputSchema: noInputSchema,
      outputSchema: stopBuildViewSchema,
      annotations: IDEMPOTENT_COMMAND,
    },
    () => respond(deps, 'stop_build', () => deps.stopBuild.stopBuild({})),
  );

  server.registerTool(
    'list_exports',
    {
      title: 'List exports',
      description:
        "List the project's outputs as World Machine's export settings name them: each device, its file name template, the path it resolves to, and whether export_outputs may write there. A path is allowed when its folder exists inside the allowed roots; a project that was never saved allows none. File names, formats, and folders are set in the World Machine window.",
      inputSchema: noInputSchema,
      outputSchema: listExportsViewSchema,
      annotations: READ_ONLY,
    },
    () => respond(deps, 'list_exports', () => deps.listExports.listExports({})),
  );

  server.registerTool(
    'export_outputs',
    {
      title: 'Export outputs',
      description:
        "Export every output of the project with World Machine's export all, after a full build. Files with the same names are overwritten without asking. Refused while a build runs, for a project that was never saved, and when any output would be written outside the allowed roots or into a missing folder (list_exports shows which). files are the paths World Machine reports; a Material Output writes four files for its one path (_diffuse, _disp, _mask, and _roughness), and note says so.",
      inputSchema: noInputSchema,
      outputSchema: exportOutputsViewSchema,
      annotations: DESTRUCTIVE,
    },
    () => respond(deps, 'export_outputs', () => deps.exportOutputs.exportOutputs({})),
  );

  return server;
}

/**
 * Spec v2a section 4: with a progress token, the wait reports elapsed seconds (the service calls every 5 s).
 * The callback runs inside a service timer, so it must never throw or reject.
 */
function progressOf(
  ctx: ServerContext,
  total: number,
  logger: Logger,
): { onProgress?: (elapsedSeconds: number) => void } {
  const progressToken = ctx.mcpReq._meta?.progressToken;
  if (progressToken === undefined) return {};
  const lost = (error: unknown) => logger.debug(`progress notification not sent: ${String(error)}`);
  return {
    onProgress: (elapsedSeconds) => {
      try {
        void Promise.resolve(
          ctx.mcpReq.notify({
            method: 'notifications/progress',
            params: {
              progressToken,
              progress: elapsedSeconds,
              total,
              message: `Build running for ${elapsedSeconds} s`,
            },
          }),
        ).catch(lost);
      } catch (error) {
        lost(error);
      }
    },
  };
}

function endpoint(device: string, port: number | undefined): WireEndpoint {
  return port === undefined ? { device } : { device, port };
}

function sceneChanges(input: {
  name?: string | undefined;
  origin_km?: { x: number; y: number } | undefined;
  size_km?: { width: number; height: number } | undefined;
  resolution?: number | undefined;
}): ConfigureSceneCommand {
  return {
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.origin_km === undefined ? {} : { originKm: input.origin_km }),
    ...(input.size_km === undefined ? {} : { sizeKm: input.size_km }),
    ...(input.resolution === undefined ? {} : { resolution: input.resolution }),
  };
}

async function respond(deps: McpDependencies, tool: string, action: () => Promise<object>) {
  try {
    return success(await action());
  } catch (error) {
    if (error instanceof WorldMachineError) return failure(error, deps.currentSession());
    // The SDK turns a thrown handler error into an isError result carrying its raw message, so the
    // original text must not travel with it. It goes to the server log (stderr) instead.
    // The logger drops licence lines from every message.
    deps.logger.error(
      `Unexpected error in ${tool}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
    throw new Error(`Internal error in ${tool}; see the server log`);
  }
}
