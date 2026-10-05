import { McpServer } from '@modelcontextprotocol/server';
import type { CreateProjectCommandPort } from '../../../application/port/in/command/create-project-command.js';
import type { OpenProjectCommandPort } from '../../../application/port/in/command/open-project-command.js';
import type { RedoCommandPort } from '../../../application/port/in/command/redo-command.js';
import type { SaveProjectCommandPort } from '../../../application/port/in/command/save-project-command.js';
import type { UndoCommandPort } from '../../../application/port/in/command/undo-command.js';
import type { GetDeviceQueryPort } from '../../../application/port/in/query/get-device-query.js';
import type { GetSceneQueryPort } from '../../../application/port/in/query/get-scene-query.js';
import type { GetStatusQueryPort } from '../../../application/port/in/query/get-status-query.js';
import type { InspectProjectQueryPort } from '../../../application/port/in/query/inspect-project-query.js';
import type { ListDevicesQueryPort } from '../../../application/port/in/query/list-devices-query.js';
import { WorldMachineError } from '../../../domain/errors.js';
import type { SessionSummary } from '../../../domain/session.js';
import {
  createProjectInputSchema,
  deviceListViewSchema,
  deviceViewSchema,
  getDeviceInputSchema,
  listDevicesInputSchema,
  noInputSchema,
  openProjectInputSchema,
  projectCommandViewSchema,
  projectViewSchema,
  saveProjectInputSchema,
  sceneViewSchema,
  statusViewSchema,
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
  readonly currentSession: () => SessionSummary;
};

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
const COMMAND = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;
const SAVE = {
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
    () => respond(deps, () => deps.getStatus.getStatus({})),
  );

  server.registerTool(
    'list_devices',
    {
      title: 'List devices',
      description:
        'List the devices in the active World Machine project with their stable ids (#n), names, and kinds. Starts World Machine if it is not running.',
      inputSchema: listDevicesInputSchema,
      outputSchema: deviceListViewSchema,
      annotations: READ_ONLY,
    },
    ({ filter }) => respond(deps, () => deps.listDevices.listDevices(filter === undefined ? {} : { filter })),
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
    ({ device }) => respond(deps, () => deps.getDevice.getDevice({ device })),
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
    () => respond(deps, () => deps.getScene.getScene({})),
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
    () => respond(deps, () => deps.inspectProject.inspectProject({})),
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
      respond(deps, () => deps.openProject.openProject({ path, discardUnsaved: discard_unsaved })),
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
      respond(deps, () => deps.createProject.createProject({ discardUnsaved: discard_unsaved })),
  );

  server.registerTool(
    'save_project',
    {
      title: 'Save project',
      description:
        'Save the project to a .tmd file. Never replaces an existing file unless overwrite is true. The save is checked on disk, because World Machine can report saves it did not perform.',
      inputSchema: saveProjectInputSchema,
      outputSchema: projectCommandViewSchema,
      annotations: SAVE,
    },
    ({ path, overwrite }) =>
      respond(deps, () =>
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
    () => respond(deps, () => deps.undo.undo({})),
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
    () => respond(deps, () => deps.redo.redo({})),
  );

  return server;
}

async function respond(deps: McpDependencies, action: () => Promise<object>) {
  try {
    return success(await action());
  } catch (error) {
    if (error instanceof WorldMachineError) return failure(error, deps.currentSession());
    throw error;
  }
}
