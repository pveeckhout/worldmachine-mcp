import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it } from 'vitest';
import { createMcpServer, type McpDependencies } from '../../../../src/adapter/in/mcp/create-server.js';
import { parseDeviceInfo } from '../../../../src/adapter/out/worldmachine/parsers/device-info.js';
import { parseDeviceList } from '../../../../src/adapter/out/worldmachine/parsers/device-list.js';
import { parseGroupList } from '../../../../src/adapter/out/worldmachine/parsers/group-list.js';
import { parseParamList } from '../../../../src/adapter/out/worldmachine/parsers/param-list.js';
import { parseSceneList, parseSceneShow } from '../../../../src/adapter/out/worldmachine/parsers/scene.js';
import { parseWireList } from '../../../../src/adapter/out/worldmachine/parsers/wire-list.js';
import type { DeviceDetail } from '../../../../src/domain/device.js';
import { WorldMachineError } from '../../../../src/domain/errors.js';
import type { ProjectOverview } from '../../../../src/domain/project.js';
import type { Scene } from '../../../../src/domain/scene.js';
import { fixtureLines } from '../../out/worldmachine/parsers/fixture.js';

const READY = { state: 'ready', binding: { kind: 'fresh' }, dirty: false } as const;

const SCENE: Scene = {
  name: 'Scene 1',
  index: 0,
  count: 1,
  originKm: { x: 0, y: 0 },
  sizeKm: { width: 10, height: 10 },
  resolution: 1024,
  locked: false,
};

function deps(overrides: Partial<McpDependencies> = {}): McpDependencies {
  return {
    version: '0.0.0-test',
    getStatus: {
      getStatus: async () => ({
        configured: true,
        executable: '/opt/wm',
        build: 4067,
        buildName: 'Dragontail Peak',
        session: READY,
      }),
    },
    listDevices: {
      listDevices: async ({ filter }) => ({
        devices: [{ id: 1, name: filter ?? 'Height Output', enabled: true, bypassed: false }],
        session: READY,
      }),
    },
    getDevice: {
      getDevice: async () => ({
        device: {
          id: 1,
          name: 'Height Output',
          type: 'HeightOutput',
          enabled: true,
          bypassed: false,
          parameters: [],
          inputs: [],
          outputs: [],
        },
        session: READY,
      }),
    },
    getScene: { getScene: async () => ({ scene: SCENE, session: READY }) },
    inspectProject: {
      inspectProject: async () => ({
        project: { scene: SCENE, scenes: [], deviceCount: 0, devices: [], groups: [] },
        session: READY,
      }),
    },
    openProject: { openProject: async (c) => ({ session: READY, path: c.path }) },
    createProject: { createProject: async () => ({ session: READY }) },
    saveProject: { saveProject: async (c) => ({ session: READY, path: c.path ?? '/r/a.tmd' }) },
    undo: { undo: async () => ({ session: READY }) },
    redo: { redo: async () => ({ session: READY }) },
    currentSession: () => READY,
    ...overrides,
  };
}

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function connect(dependencies: McpDependencies): Promise<Client> {
  const handler = createMcpHandler(() => createMcpServer(dependencies));
  const client = new Client({ name: 'test', version: '0.0.0' });
  cleanups.push(
    () => client.close(),
    () => handler.close(),
  );
  await client.connect(
    new StreamableHTTPClientTransport(new URL('http://test.local/mcp'), {
      fetch: (url, init) => handler.fetch(new Request(url, init)),
    }),
  );
  return client;
}

describe('createMcpServer', () => {
  it('registers all ten tools as closed-world, the five read tools as read-only', async () => {
    const { tools } = await (await connect(deps())).listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'create_project',
      'get_device',
      'get_scene',
      'get_world_machine_status',
      'inspect_project',
      'list_devices',
      'open_project',
      'redo',
      'save_project',
      'undo',
    ]);
    const readTools = [
      'get_device',
      'get_scene',
      'get_world_machine_status',
      'inspect_project',
      'list_devices',
    ];
    for (const tool of tools) {
      if (readTools.includes(tool.name)) {
        expect(tool.annotations).toMatchObject({
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: false,
        });
      } else {
        expect(tool.annotations).toMatchObject({ openWorldHint: false });
      }
      expect(tool.outputSchema).toBeDefined();
    }
  });

  it('marks save_project as destructive and the other commands as not destructive', async () => {
    const { tools } = await (await connect(deps())).listTools();
    const hints = Object.fromEntries(tools.map((t) => [t.name, t.annotations?.destructiveHint]));
    expect(hints).toMatchObject({
      save_project: true,
      open_project: false,
      create_project: false,
      undo: false,
      redo: false,
    });
  });

  it('maps snake_case arguments to command objects', async () => {
    const seen: unknown[] = [];
    const client = await connect(
      deps({
        openProject: {
          openProject: async (c) => {
            seen.push(c);
            return { session: READY, path: c.path };
          },
        },
        saveProject: {
          saveProject: async (c) => {
            seen.push(c);
            return { session: READY, path: '/r/a.tmd' };
          },
        },
      }),
    );
    await client.callTool({ name: 'open_project', arguments: { path: '/r/b.tmd', discard_unsaved: true } });
    await client.callTool({ name: 'save_project', arguments: {} });
    expect(seen).toEqual([{ path: '/r/b.tmd', discardUnsaved: true }, { overwrite: false }]);
  });

  it('returns status as structured content', async () => {
    const result = await (await connect(deps())).callTool({
      name: 'get_world_machine_status',
      arguments: {},
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      configured: true,
      executable: '/opt/wm',
      build: 4067,
      buildName: 'Dragontail Peak',
      session: READY,
    });
  });

  it('passes the filter to the list-devices port', async () => {
    const result = await (await connect(deps())).callTool({
      name: 'list_devices',
      arguments: { filter: 'Erosion' },
    });
    expect(result.structuredContent).toEqual({
      devices: [{ id: 1, name: 'Erosion', enabled: true, bypassed: false }],
      session: READY,
    });
  });

  it('rejects an empty filter through the schema', async () => {
    const result = await (await connect(deps())).callTool({
      name: 'list_devices',
      arguments: { filter: '' },
    });
    expect(result.isError).toBe(true);
  });

  it('returns WorldMachineError as an error result with code, World Machine text, and session', async () => {
    const failing = deps({
      listDevices: {
        listDevices: async () => {
          throw new WorldMachineError(
            'WM_COMMAND_FAILED',
            'World Machine rejected "device list"',
            'Error: boom',
          );
        },
      },
      currentSession: () => ({ state: 'unhealthy', reason: 'timeout' }),
    });
    const result = await (await connect(failing)).callTool({ name: 'list_devices', arguments: {} });
    expect(result.isError).toBe(true);
    const content = result.content as { type: string; text: string }[];
    expect(JSON.parse(content[0]?.text ?? '')).toEqual({
      code: 'WM_COMMAND_FAILED',
      message: 'World Machine rejected "device list"',
      worldMachineMessage: 'Error: boom',
      session: { state: 'unhealthy', reason: 'timeout' },
    });
  });

  it('removes licence lines from the World Machine text in error results', async () => {
    const failing = deps({
      listDevices: {
        listDevices: async () => {
          throw new WorldMachineError(
            'START_FAILED',
            'exited',
            'fatal: no seat\nLicense Manager.Checkout: denied',
          );
        },
      },
    });
    const result = await (await connect(failing)).callTool({ name: 'list_devices', arguments: {} });
    const content = result.content as { type: string; text: string }[];
    expect(JSON.parse(content[0]?.text ?? '').worldMachineMessage).toBe('fatal: no seat');
  });
});

describe('createMcpServer with parser output from the wm-4067 fixtures', () => {
  const erosion: DeviceDetail = {
    id: 35,
    ...parseDeviceInfo(fixtureLines('device-info-erosion.txt')),
    parameters: parseParamList(fixtureLines('param-list-erosion.txt')),
    ...parseWireList(fixtureLines('wire-list-erosion.txt')),
  };
  const scene = parseSceneShow(fixtureLines('scene-show.txt'));
  const devices = parseDeviceList(fixtureLines('device-list.txt'));
  const project: ProjectOverview = {
    scene,
    scenes: parseSceneList(fixtureLines('scene-list.txt')),
    deviceCount: devices.length,
    devices,
    groups: parseGroupList(fixtureLines('group-list.txt')),
  };

  it('builds the views from complete parser output', () => {
    expect(erosion.parameters).toHaveLength(20);
    expect(erosion.outputs).toHaveLength(5);
    expect(project.devices).toHaveLength(17);
    expect(project.devices.some((device) => device.kind !== undefined)).toBe(true);
    expect(project.groups).toHaveLength(5);
  });

  it('returns get_device with the parsed device as structured content', async () => {
    const client = await connect(
      deps({ getDevice: { getDevice: async () => ({ device: erosion, session: READY }) } }),
    );
    const result = await client.callTool({ name: 'get_device', arguments: { device: 'Erosion' } });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ device: erosion, session: READY });
  });

  it('returns get_scene with the parsed scene as structured content', async () => {
    const client = await connect(deps({ getScene: { getScene: async () => ({ scene, session: READY }) } }));
    const result = await client.callTool({ name: 'get_scene', arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ scene, session: READY });
  });

  it('returns inspect_project with the parsed overview as structured content', async () => {
    const client = await connect(
      deps({ inspectProject: { inspectProject: async () => ({ project, session: READY }) } }),
    );
    const result = await client.callTool({ name: 'inspect_project', arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ project, session: READY });
  });

  it('rejects structured content that does not match the output schema', async () => {
    const client = await connect(
      deps({
        getScene: { getScene: async () => ({ scene: { ...scene, resolution: 1.5 }, session: READY }) },
      }),
    );
    const result = await client.callTool({ name: 'get_scene', arguments: {} });
    expect(result.isError).toBe(true);
  });
});
