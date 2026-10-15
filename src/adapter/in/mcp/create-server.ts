import { McpServer, type ServerContext } from '@modelcontextprotocol/server';
import type { AddDeviceCommandPort } from '../../../application/port/in/command/add-device-command.js';
import type { ApplyGraphCommandPort } from '../../../application/port/in/command/apply-graph-command.js';
import type { BuildProjectCommandPort } from '../../../application/port/in/command/build-project-command.js';
import type {
  ConfigureSceneCommand,
  ConfigureSceneCommandPort,
} from '../../../application/port/in/command/configure-scene-command.js';
import type { ConnectDevicesCommandPort } from '../../../application/port/in/command/connect-devices-command.js';
import type { CreateProjectCommandPort } from '../../../application/port/in/command/create-project-command.js';
import type { CreateSnapshotCommandPort } from '../../../application/port/in/command/create-snapshot-command.js';
import type { DeleteDeviceCommandPort } from '../../../application/port/in/command/delete-device-command.js';
import type { DeleteSnapshotCommandPort } from '../../../application/port/in/command/delete-snapshot-command.js';
import type { DisconnectDevicesCommandPort } from '../../../application/port/in/command/disconnect-devices-command.js';
import type { ExportOutputsCommandPort } from '../../../application/port/in/command/export-outputs-command.js';
import type { OpenProjectCommandPort } from '../../../application/port/in/command/open-project-command.js';
import type { OrganizeDevicesCommandPort } from '../../../application/port/in/command/organize-devices-command.js';
import type { RedoCommandPort } from '../../../application/port/in/command/redo-command.js';
import type { RenameDeviceCommandPort } from '../../../application/port/in/command/rename-device-command.js';
import type { RestoreSnapshotCommandPort } from '../../../application/port/in/command/restore-snapshot-command.js';
import type { SaveProjectCommandPort } from '../../../application/port/in/command/save-project-command.js';
import type { SetDeviceBypassedCommandPort } from '../../../application/port/in/command/set-device-bypassed-command.js';
import type { SetDeviceEnabledCommandPort } from '../../../application/port/in/command/set-device-enabled-command.js';
import type { SetGroupEnabledCommandPort } from '../../../application/port/in/command/set-group-enabled-command.js';
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
import type { ListGroupsQueryPort } from '../../../application/port/in/query/list-groups-query.js';
import type { ListSnapshotsQueryPort } from '../../../application/port/in/query/list-snapshots-query.js';
import type { PlanGraphQueryPort } from '../../../application/port/in/query/plan-graph-query.js';
import { WorldMachineError } from '../../../domain/errors.js';
import type { WireEndpoint } from '../../../domain/graph-edit.js';
import type { SessionSummary } from '../../../domain/session.js';
import type { Logger } from '../../../logger.js';
import {
  addDeviceInputSchema,
  addDeviceViewSchema,
  applyGraphInputSchema,
  applyGraphViewSchema,
  buildProjectInputSchema,
  buildProjectViewSchema,
  buildStatusViewSchema,
  configureSceneInputSchema,
  configureSceneViewSchema,
  connectDevicesViewSchema,
  createProjectInputSchema,
  createSnapshotInputSchema,
  createSnapshotViewSchema,
  deleteDeviceInputSchema,
  deleteDeviceViewSchema,
  deleteSnapshotViewSchema,
  deviceListViewSchema,
  deviceViewSchema,
  disconnectDevicesViewSchema,
  exportOutputsViewSchema,
  getDeviceInputSchema,
  groupListViewSchema,
  listDevicesInputSchema,
  listExportsViewSchema,
  listGroupsInputSchema,
  noInputSchema,
  openProjectInputSchema,
  organizeDevicesViewSchema,
  planGraphInputSchema,
  planGraphViewSchema,
  projectCommandViewSchema,
  projectViewSchema,
  renameDeviceInputSchema,
  renameDeviceViewSchema,
  restoreSnapshotViewSchema,
  saveProjectInputSchema,
  sceneViewSchema,
  setDeviceBypassedInputSchema,
  setDeviceBypassedViewSchema,
  setDeviceEnabledInputSchema,
  setDeviceEnabledViewSchema,
  setGroupEnabledInputSchema,
  setGroupEnabledViewSchema,
  snapshotListViewSchema,
  snapshotReferenceInputSchema,
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
  readonly setDeviceBypassed: SetDeviceBypassedCommandPort;
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
  readonly listSnapshots: ListSnapshotsQueryPort;
  readonly createSnapshot: CreateSnapshotCommandPort;
  readonly restoreSnapshot: RestoreSnapshotCommandPort;
  readonly deleteSnapshot: DeleteSnapshotCommandPort;
  readonly organizeDevices: OrganizeDevicesCommandPort;
  readonly listGroups: ListGroupsQueryPort;
  readonly setGroupEnabled: SetGroupEnabledCommandPort;
  readonly planGraph: PlanGraphQueryPort;
  readonly applyGraph: ApplyGraphCommandPort;
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
        'Show one device: type, enabled and bypass state, every parameter with its current value as World Machine displays it, and its input and output connections. An enum row lists its options in index order when the catalog shipped with the server covers the device; the catalog describes devices as device add creates them, and enumOptionsNote says why options are missing (another build, a type or parameter the catalog lacks, other parameters than a new device has, or a current value the catalog does not list). Each output shows its port type (type) and each input the types it accepts (accepts) when portTypes is catalogued: World Machine is the build of the port-type catalog shipped with the server and the ports of the device equal those of a new device of its type; otherwise portTypes is unknown and the port types are left out.',
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
        'Enable or disable a device. World Machine prints the same confirmation whether or not the state changed, so the device is read back: enabled is the state World Machine reports afterwards, and changed tells whether it differs from before.',
      inputSchema: setDeviceEnabledInputSchema,
      outputSchema: setDeviceEnabledViewSchema,
      annotations: IDEMPOTENT_COMMAND,
    },
    ({ device, enabled }) =>
      respond(deps, 'set_device_enabled', () => deps.setDeviceEnabled.setDeviceEnabled({ device, enabled })),
  );

  server.registerTool(
    'set_device_bypassed',
    {
      title: 'Bypass or unbypass device',
      description:
        'Set (not toggle) the bypass of a device, referenced by name or #<n>: a bypassed device passes its input through unchanged. A disabled device can be bypassed too. list_devices does not show bypass for a disabled device, so get_device is the authority. World Machine only toggles bypass, so the device is read first and nothing is sent when it is already in the requested state: bypassed is the state World Machine reports afterwards, and changed tells whether it differs from before.',
      inputSchema: setDeviceBypassedInputSchema,
      outputSchema: setDeviceBypassedViewSchema,
      annotations: IDEMPOTENT_COMMAND,
    },
    ({ device, bypassed }) =>
      respond(deps, 'set_device_bypassed', () =>
        deps.setDeviceBypassed.setDeviceBypassed({ device, bypassed }),
      ),
  );

  server.registerTool(
    'update_device_parameters',
    {
      title: 'Update device parameters',
      description:
        "Set one or more parameters of one device; give at least one. Every name and value is checked against the device's parameter list first; if any is invalid, nothing is set. Names are case-sensitive. Numeric values are World Machine's internal values, not the units it displays: setting a width of 0.5 can read back as 4 km. A float whose value shows m or km also takes a length such as \"500 m\" or \"2.5km\", converted through the parameter's scale, which the call reads by setting the parameter to 1 and undoing that set; an item whose scale was read reports given and scale (an item rejected at the probe has neither), the probe marks the project unsaved even after its undo, and when no item is set after a length item's probe, do not use redo before another edit, since it would set that parameter to 1. The read-back of a length item can differ from the length given by World Machine's display rounding (656.25 m reads 656.2 m). A plain number is always an internal value. This tool takes floats and integers in plain decimal notation, enum options as the 0-based index of their label in get_device's options (a row without options has its reason in enumOptionsNote; finding an index by setting values makes unsaved changes), and booleans as true or false (or 1, 0, yes, off); World Machine itself would also take exponent forms, enum labels, and other boolean words, which this tool refuses so that each value is checked before it is sent. Action, other, and filename parameters and exportAlways cannot be set (filename would let World Machine write outside the allowed roots, and exportAlways makes every full build write files). Each item reports whether World Machine applied or rejected it and the value read back afterwards, in display units. There is no automatic rollback; undo reverts one parameter per call.",
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
        "Connect an output port of the source device to an input port of the destination device. Ports are 1-based and default to 1. A wire that already exists is left alone (created: false). When the destination's input shows the source's name and several devices share that name, their connections are read to tell which one feeds it, and the call is refused, naming their ids, when that cannot be told. World Machine refuses an input that is already connected to another output; disconnect that wire first. Port types are not checked before connecting; when World Machine refuses a wire as incompatible types and both devices have catalogued port types (see get_device), the error names the output's type and the types the input accepts.",
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
        "Remove the wire from the source device's output port to the destination device's input port (ports default to 1). World Machine confirms a disconnection even when no wire existed, so the destination's connections are read before and after: removed is false when there was no such wire, and then nothing is sent. When the input shows the source's name and several devices share that name, their connections are read to tell which one feeds it, and the call is refused, naming their ids, when that cannot be told.",
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
        "Build the project in World Machine and wait up to wait_seconds (default 60, at most 600) for the build to end. preview runs World Machine's quick preview; full builds every device at the scene resolution and writes no files; tiled runs the tiled build set up in the World Machine window and writes every output as tiles next to its export path, overwriting files of the same name without asking; group builds the devices of one device group, given as group (a name in any case, or #<n> from list_groups; required for mode group and refused for the others), and is tracked like a full build. A group build does not make the outputs exportable: export_outputs still needs a full build. A tiled build checks its targets itself and is refused unless the project was saved and every output folder exists inside the allowed roots; it also refuses a file name template that uses <res> in a folder name, and one with an unknown template token, whose value the server cannot know. A full or group build checks the same way when an output has exportAlways set (or its setting cannot be read), because such an output may be written on every full build. A group without devices is refused. If the wait ends first, state is running and the build continues: check get_build_status, or call stop_build; get_build_status reports the check once the build ends. A build ended by stop_build is reported as finished. While a full, tiled, or group build runs, every other change tool is refused. World Machine ends a build that built nothing the same way as one that built. After a full build that finished within the wait, the result reports whether every output was built (outputsBuilt), the outputs that were not (notBuilt), the devices where building stopped on the way to an output that was not built (stoppedAt: devices without a result whose wired inputs all have one), and a hint when an output was not built; a full build ended by stop_build is checked too and its outputs report not built. If the check itself fails, the build is still finished and outputsCheckError says why. preview, tiled, and group builds, and a running result, are not checked, so there finished means only that the build ended.",
      inputSchema: buildProjectInputSchema,
      outputSchema: buildProjectViewSchema,
      annotations: DESTRUCTIVE,
    },
    ({ mode, group, wait_seconds }, ctx) =>
      respond(deps, 'build_project', () =>
        deps.buildProject.buildProject({
          mode,
          ...(group === undefined ? {} : { group }),
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
        "Report the running full or tiled build (mode, seconds since it started, and whether this server or the World Machine window started it) and whether a preview is running. A build started in the World Machine window shows only if World Machine prints its build events to the console; its mode is unknown until it shows as a full build (a tiled one stays unknown). Never starts World Machine. After a full build that build_project started has ended, also reports whether every output was built and where building stopped (lastFullBuild). The first call after a build that outlived build_project's wait runs that check; later calls repeat it. If this server changed the project after the build ended, the check is skipped. Edits made in the World Machine window are not seen.",
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

  // Spec v2b section 3: snapshots serve as checkpoints and as variants; the tools are the same for both.

  server.registerTool(
    'list_snapshots',
    {
      title: 'List snapshots',
      description:
        "List the project's snapshots: index, name, and the time World Machine made each (YYYY-MM-DD HH:MM). A snapshot holds the device graph, as a checkpoint before risky edits or as a variant of the project to switch back to.",
      inputSchema: noInputSchema,
      outputSchema: snapshotListViewSchema,
      annotations: READ_ONLY,
    },
    () => respond(deps, 'list_snapshots', () => deps.listSnapshots.listSnapshots({})),
  );

  server.registerTool(
    'create_snapshot',
    {
      title: 'Create snapshot',
      description:
        'Take a named snapshot of the device graph, as a checkpoint before risky edits or as a variant to switch back to with restore_snapshot. The snapshot is stored in the project file and is kept only after save_project: closing the project without saving loses it, so the session counts as unsaved afterwards. Names are 1 to 64 characters without leading or trailing spaces, quotes, backslashes, or the form #<n>; a name that another snapshot already has is refused, because later references by that name would be ambiguous.',
      inputSchema: createSnapshotInputSchema,
      outputSchema: createSnapshotViewSchema,
      annotations: COMMAND,
    },
    ({ name }) => respond(deps, 'create_snapshot', () => deps.createSnapshot.createSnapshot({ name })),
  );

  server.registerTool(
    'restore_snapshot',
    {
      title: 'Restore snapshot',
      description:
        'Revert the device graph to a snapshot (a checkpoint, or the variant to switch to), referenced by its exact name or #<n> from list_snapshots. A name of the form #<n> is read as an index, so a snapshot whose name looks like that is reached by its #<index>. Snapshots made after it are kept. One undo reverts the restore. The project counts as unsaved afterwards. A name that several snapshots share is refused; use the index.',
      inputSchema: snapshotReferenceInputSchema,
      outputSchema: restoreSnapshotViewSchema,
      annotations: DESTRUCTIVE,
    },
    ({ snapshot }) =>
      respond(deps, 'restore_snapshot', () => deps.restoreSnapshot.restoreSnapshot({ snapshot })),
  );

  server.registerTool(
    'delete_snapshot',
    {
      title: 'Delete snapshot',
      description:
        'Delete a snapshot (a checkpoint or a variant), referenced by its exact name or #<n> from list_snapshots. A name of the form #<n> is read as an index, so a snapshot whose name looks like that is reached by its #<index>. The snapshots after it move down one index; remaining lists them. The project counts as unsaved afterwards, and save_project keeps the deletion.',
      inputSchema: snapshotReferenceInputSchema,
      outputSchema: deleteSnapshotViewSchema,
      annotations: DESTRUCTIVE,
    },
    ({ snapshot }) =>
      respond(deps, 'delete_snapshot', () => deps.deleteSnapshot.deleteSnapshot({ snapshot })),
  );

  server.registerTool(
    'organize_devices',
    {
      title: 'Organize devices',
      description:
        'Lay the device graph out in the World Machine window by processing order. Only the layout changes, and the console cannot show it. undo is expected to revert the layout, but the console cannot confirm it. The project counts as unsaved afterwards.',
      inputSchema: noInputSchema,
      outputSchema: organizeDevicesViewSchema,
      annotations: IDEMPOTENT_COMMAND,
    },
    () => respond(deps, 'organize_devices', () => deps.organizeDevices.organizeDevices({})),
  );

  server.registerTool(
    'list_groups',
    {
      title: 'List groups',
      description:
        "List the project's device groups: index, name, and device count. The console does not show which devices a group holds or whether they are enabled. Groups are created and filled in the World Machine window. filter is passed to World Machine's group list command; the header keeps the full count, so the indexes are those of the full list.",
      inputSchema: listGroupsInputSchema,
      outputSchema: groupListViewSchema,
      annotations: READ_ONLY,
    },
    ({ filter }) =>
      respond(deps, 'list_groups', () => deps.listGroups.listGroups(filter === undefined ? {} : { filter })),
  );

  server.registerTool(
    'set_group_enabled',
    {
      title: 'Enable or disable group',
      description:
        "Enable or disable every device of a group, referenced by name (any case) or #<n> from list_groups. A name of the form #<n> is read as an index, so a group whose name looks like that, or ends in spaces, is reached by its #<index>. This sets each member device's own enabled state, so enabling a group also enables members that were disabled one by one. One undo reverts the whole group. A group without devices is not an error: deviceCount is 0 and nothing changes.",
      inputSchema: setGroupEnabledInputSchema,
      outputSchema: setGroupEnabledViewSchema,
      annotations: IDEMPOTENT_COMMAND,
    },
    ({ group, enabled }) =>
      respond(deps, 'set_group_enabled', () => deps.setGroupEnabled.setGroupEnabled({ group, enabled })),
  );

  server.registerTool(
    'plan_graph',
    {
      title: 'Plan graph',
      description:
        'Plan the changes that bring the devices a graph spec names to the state it gives, without changing anything. The spec is { version: 1, scene?: { name?, origin_km?, size_km?, resolution? }, devices: [{ name, id?, rename?, type, enabled?, bypassed?, parameters?, inputs? }], remove?: [names or #<id>] }. A device the spec names is managed: an entry without id is added when no device has its name (compared regardless of case), and otherwise only the fields its entry gives are changed. An entry with id manages that existing device whatever its name and never adds one; its name is then a label that inputs refer to, sent to World Machine only with rename: true, which renames the device to it (a conflict for a Combiner, for a name another kept device has, and for a source that still uses the old name). World Machine ignores a rename of a Combiner, so a Combiner entry without id must be named exactly Combiner and typed Combiner, not an alias such as Average; for more Combiners, add each with add_device and give its id in the entry. Devices the spec does not name are never changed, except that their wires to removed devices go with them; deleting needs the remove list. scene sets the current scene as configure_scene does, in one set-scene step before every device step; origin and size are in km with at most two decimals, because World Machine shows two; a locked scene with a difference is a conflict, and a scene that matches is listed in unchanged as scene. bypassed is set, not toggled, and compared exactly with the bypass World Machine reports, so a second plan of the same spec plans nothing for it. inputs maps an input port number to a source, "<device>" or "<device>.<port>" (output port 1 when omitted; the device is a managed name or label, the name of any device, or #<id>), or to null for no wire; ports not listed are left alone. When several devices share the name an input shows as its source, their output targets tell which one feeds it; a source they cannot tell is a conflict naming the candidate ids. unidentifiableWires lists each wire into a managed device that the plan would leave unidentifiable, where two same-named devices (for example two Combiners) each feed the same input port number of two devices that also share a name: apply_graph still applies it, but disconnect_devices then refuses that wire, and a later plan reports that input as a conflict when the spec lists it and lists it in unidentifiableWires again otherwise, until one of the wires is changed in the World Machine window or by undo. A wire that would close a loop in the wiring after the apply is a conflict, since World Machine refuses it; a wire that may close one through devices whose wires cannot be told apart is listed in possibleLoops and refuses nothing. Returns planId, the ordered steps, conflicts (apply_graph refuses a plan with any), and the managed devices left unchanged. A wire whose output port type the input does not accept is a conflict when both devices have catalogued port types (see get_device; a device the plan adds is typed only when its type is an add word the catalog was captured with); a wire with an end whose port types are unknown is listed in uncheckedWires and not checked. The catalog comes from unconnected devices; for a device whose type may follow its inputs (Chooser, Combiner, Layers, Router) only a fed Chooser or Combiner into Material Output was checked live, so another fed combination rests on the unconnected device, and connect_devices can still try such a wire. Float and enum parameters are always planned (comparable: false), since World Machine shows floats in display units and enums as labels while it takes internal values and indexes. An enum value in a spec is the 0-based index of its label in the options get_device lists. Show the plan to the user before calling apply_graph.',
      inputSchema: planGraphInputSchema,
      outputSchema: planGraphViewSchema,
      annotations: READ_ONLY,
    },
    ({ spec, template }) =>
      respond(deps, 'plan_graph', () =>
        deps.planGraph.planGraph({
          ...(spec === undefined ? {} : { spec }),
          ...(template === undefined ? {} : { template }),
        }),
      ),
  );

  server.registerTool(
    'apply_graph',
    {
      title: 'Apply graph',
      description:
        "Apply a graph spec planned with plan_graph: pass the same spec and its planId as plan_id. Plan first and show the plan to the user. An entry with id is never added, and is renamed to its name only with rename: true; a failed apply restores the old name with the snapshot. The plan is made again inside this call; if the project or the spec changed since plan_graph, or the plan has conflicts, nothing is changed. The steps run under a snapshot named 'apply_graph <first 12 characters of planId>', taken before the first step; if a step fails, the project is restored to it (unless World Machine timed out or crashed, in which case nothing is restored and the snapshot is gone) and the result is APPLY_FAILED with the failed step, the number of completed steps, whether the rollback was confirmed (rolledBack), and the snapshot, which is kept for inspection. After success the snapshot is deleted unless keep_snapshot is true. If the result cannot be read back after a successful apply, the result says so in diffError and keeps the snapshot. The result shows the scene settings it changed in scene. The result repeats the plan's unidentifiableWires, the wires into managed devices that a later plan cannot identify. It also repeats the plan's possibleLoops; World Machine refuses such a wire if it does close a loop, and the apply then rolls back. Float and enum parameters are always set because their current value cannot be compared. undo does not revert an apply in one step; the snapshot does. Refused while a build runs.",
      inputSchema: applyGraphInputSchema,
      outputSchema: applyGraphViewSchema,
      annotations: DESTRUCTIVE,
    },
    ({ spec, template, plan_id, keep_snapshot }) =>
      respond(deps, 'apply_graph', () =>
        deps.applyGraph.applyGraph({
          ...(spec === undefined ? {} : { spec }),
          ...(template === undefined ? {} : { template }),
          planId: plan_id,
          keepSnapshot: keep_snapshot ?? false,
        }),
      ),
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
