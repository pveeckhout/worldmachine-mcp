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
const READY_DIRTY = { state: 'ready', binding: { kind: 'fresh' }, dirty: true } as const;
const GRADIENT = { id: 1, name: 'Gradient', enabled: true, bypassed: false };
const WIRE = {
  source: { id: 1, name: 'Gradient', port: 1 },
  destination: { id: 2, name: 'Combiner', port: 1 },
};

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
    addDevice: { addDevice: async () => ({ device: GRADIENT, session: READY_DIRTY }) },
    renameDevice: {
      renameDevice: async (c) => ({
        device: { ...GRADIENT, name: c.name, kind: 'Gradient' },
        previousName: 'Gradient',
        session: READY_DIRTY,
      }),
    },
    setDeviceEnabled: {
      setDeviceEnabled: async (c) => ({
        device: { id: 1, name: 'Gradient' },
        enabled: c.enabled,
        changed: true,
        session: READY_DIRTY,
      }),
    },
    deleteDevice: { deleteDevice: async () => ({ deleted: GRADIENT, session: READY_DIRTY }) },
    updateDeviceParameters: {
      updateDeviceParameters: async () => ({
        device: { id: 1, name: 'Gradient' },
        parameters: [
          { name: 'Width', type: 'float', requested: '0.5', outcome: 'applied', value: '4 km' },
          // raw/p2c-edits.txt l.218-222 (spec fact 35).
          {
            name: 'Tiling',
            type: 'enum',
            requested: '99',
            outcome: 'rejected',
            value: 'Clamp',
            worldMachineMessage: 'Error: Error: Enum index out of range (0-2): 99',
          },
        ],
        session: READY_DIRTY,
      }),
    },
    connectDevices: { connectDevices: async () => ({ ...WIRE, created: true, session: READY_DIRTY }) },
    disconnectDevices: { disconnectDevices: async () => ({ ...WIRE, removed: false, session: READY }) },
    configureScene: { configureScene: async () => ({ scene: SCENE, session: READY_DIRTY }) },
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
  it('registers all eighteen tools as closed-world, the five read tools as read-only', async () => {
    const { tools } = await (await connect(deps())).listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'add_device',
      'configure_scene',
      'connect_devices',
      'create_project',
      'delete_device',
      'disconnect_devices',
      'get_device',
      'get_scene',
      'get_world_machine_status',
      'inspect_project',
      'list_devices',
      'open_project',
      'redo',
      'rename_device',
      'save_project',
      'set_device_enabled',
      'undo',
      'update_device_parameters',
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

describe('createMcpServer edit tools', () => {
  const ANNOTATIONS = (destructive: boolean, idempotent: boolean) => ({
    readOnlyHint: false,
    destructiveHint: destructive,
    idempotentHint: idempotent,
    openWorldHint: false,
  });

  it('annotates the eight edit tools as spec section 7 says', async () => {
    const { tools } = await (await connect(deps())).listTools();
    const annotations = Object.fromEntries(tools.map((tool) => [tool.name, tool.annotations]));
    expect(annotations).toMatchObject({
      add_device: ANNOTATIONS(false, false),
      rename_device: ANNOTATIONS(false, true),
      set_device_enabled: ANNOTATIONS(false, true),
      update_device_parameters: ANNOTATIONS(false, true),
      connect_devices: ANNOTATIONS(false, true),
      disconnect_devices: ANNOTATIONS(false, true),
      configure_scene: ANNOTATIONS(false, true),
      delete_device: ANNOTATIONS(true, false),
      save_project: ANNOTATIONS(true, false),
    });
  });

  it('tells the model about internal values, display units, and undo in update_device_parameters', async () => {
    const { tools } = await (await connect(deps())).listTools();
    const description = tools.find((tool) => tool.name === 'update_device_parameters')?.description ?? '';
    expect(description).toContain("World Machine's internal values");
    expect(description).toContain('display units');
    expect(description).toContain('undo');
  });

  it('maps snake_case arguments to command objects', async () => {
    const seen: unknown[] = [];
    const record =
      <T>(view: T) =>
      async (command: unknown) => {
        seen.push(command);
        return view;
      };
    const client = await connect(
      deps({
        addDevice: { addDevice: record({ device: GRADIENT, session: READY_DIRTY }) },
        connectDevices: { connectDevices: record({ ...WIRE, created: true, session: READY_DIRTY }) },
        disconnectDevices: { disconnectDevices: record({ ...WIRE, removed: true, session: READY_DIRTY }) },
        configureScene: { configureScene: record({ scene: SCENE, session: READY_DIRTY }) },
        updateDeviceParameters: {
          updateDeviceParameters: record({
            device: { id: 1, name: 'Gradient' },
            parameters: [],
            session: READY_DIRTY,
          }),
        },
      }),
    );
    await client.callTool({ name: 'add_device', arguments: { type: 'Gradient' } });
    await client.callTool({ name: 'add_device', arguments: { type: 'Gradient', name: 'Grad A' } });
    await client.callTool({
      name: 'connect_devices',
      arguments: { source: 'Gradient', destination: '#2', destination_port: 2 },
    });
    await client.callTool({
      name: 'disconnect_devices',
      arguments: { source: '#1', source_port: 1, destination: '#2' },
    });
    await client.callTool({
      name: 'configure_scene',
      arguments: { origin_km: { x: 1.5, y: -2 }, size_km: { width: 8, height: 4 }, resolution: 1025 },
    });
    await client.callTool({
      name: 'update_device_parameters',
      arguments: { device: '#1', parameters: { Width: 0.5, exportAlways: true, Tiling: '1' } },
    });
    expect(seen).toEqual([
      { type: 'Gradient' },
      { type: 'Gradient', name: 'Grad A' },
      { source: { device: 'Gradient' }, destination: { device: '#2', port: 2 } },
      { source: { device: '#1', port: 1 }, destination: { device: '#2' } },
      { originKm: { x: 1.5, y: -2 }, sizeKm: { width: 8, height: 4 }, resolution: 1025 },
      { device: '#1', parameters: { Width: 0.5, exportAlways: true, Tiling: '1' } },
    ]);
  });

  it.each([
    ['add_device', { type: 'Gradient' }],
    ['rename_device', { device: '#1', name: 'Grad A' }],
    ['set_device_enabled', { device: '#1', enabled: false }],
    ['delete_device', { device: '#1' }],
    ['update_device_parameters', { device: '#1', parameters: { Width: 0.5 } }],
    ['connect_devices', { source: '#1', destination: '#2' }],
    ['disconnect_devices', { source: '#1', destination: '#2' }],
    ['configure_scene', { resolution: 1025 }],
  ])('returns %s views as structured content that matches its output schema', async (name, args) => {
    const result = await (await connect(deps())).callTool({ name, arguments: args });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toBeDefined();
  });

  it('rejects a view with a field the output schema does not declare', async () => {
    const client = await connect(
      deps({
        connectDevices: {
          connectDevices: async () =>
            ({ ...WIRE, created: true, session: READY_DIRTY, extra: 1 }) as unknown as Awaited<
              ReturnType<McpDependencies['connectDevices']['connectDevices']>
            >,
        },
      }),
    );
    const result = await client.callTool({
      name: 'connect_devices',
      arguments: { source: '#1', destination: '#2' },
    });
    expect(result.isError).toBe(true);
  });

  it.each([
    ['configure_scene', { resolution: 1.5 }],
    ['configure_scene', { size_km: { width: 0, height: 4 } }],
    ['connect_devices', { source: '#1', destination: '#2', destination_port: 0 }],
    ['add_device', { type: '' }],
  ])('rejects invalid %s arguments through the schema', async (name, args) => {
    const result = await (await connect(deps())).callTool({ name, arguments: args });
    expect(result.isError).toBe(true);
  });
});
