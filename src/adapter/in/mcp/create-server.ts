import { McpServer } from '@modelcontextprotocol/server';
import type { GetStatusQueryPort } from '../../../application/port/in/query/get-status-query.js';
import type { ListDevicesQueryPort } from '../../../application/port/in/query/list-devices-query.js';
import { WorldMachineError } from '../../../domain/errors.js';
import type { SessionSummary } from '../../../domain/session.js';
import { deviceListViewSchema, listDevicesInputSchema, noInputSchema, statusViewSchema } from './schemas.js';
import { failure, success } from './tool-result.js';

export type McpDependencies = {
  readonly version: string;
  readonly getStatus: GetStatusQueryPort;
  readonly listDevices: ListDevicesQueryPort;
  readonly currentSession: () => SessionSummary;
};

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

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
