import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createMcpHandler, InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it } from 'vitest';
import { createMcpServer, type McpDependencies } from '../../../../src/adapter/in/mcp/create-server.js';
import { parseDeviceInfo } from '../../../../src/adapter/out/worldmachine/parsers/device-info.js';
import { parseDeviceList } from '../../../../src/adapter/out/worldmachine/parsers/device-list.js';
import { parseGroupList } from '../../../../src/adapter/out/worldmachine/parsers/group-list.js';
import { parseParamList } from '../../../../src/adapter/out/worldmachine/parsers/param-list.js';
import { parseSceneList, parseSceneShow } from '../../../../src/adapter/out/worldmachine/parsers/scene.js';
import { parseSnapshotList } from '../../../../src/adapter/out/worldmachine/parsers/snapshot-list.js';
import { parseWireList } from '../../../../src/adapter/out/worldmachine/parsers/wire-list.js';
import type { BuildProjectCommand } from '../../../../src/application/port/in/command/build-project-command.js';
import type { DeviceDetail } from '../../../../src/domain/device.js';
import { WorldMachineError } from '../../../../src/domain/errors.js';
import type { ProjectOverview } from '../../../../src/domain/project.js';
import type { Scene } from '../../../../src/domain/scene.js';
import type { SessionSummary } from '../../../../src/domain/session.js';
import { createLogger, type Logger } from '../../../../src/logger.js';
import { fixtureLines, rawFrame } from '../../out/worldmachine/parsers/fixture.js';

const READY = { state: 'ready', binding: { kind: 'fresh' }, dirty: false } as const;
const READY_DIRTY = { state: 'ready', binding: { kind: 'fresh' }, dirty: true } as const;
const GRADIENT = { id: 1, name: 'Gradient', enabled: true, bypassed: false };
const WIRE = {
  source: { id: 1, name: 'Gradient', port: 1 },
  destination: { id: 2, name: 'Combiner', port: 1 },
};

// raw/v2b-snapshots.txt l.31 and raw/v2b-groups.txt l.18.
const SNAPSHOT = { index: 0, name: 'A', created: '2026-10-06 11:09' };
const TERRAIN = { index: 0, name: 'Create your Terrain', deviceCount: 6 };

const SCENE: Scene = {
  name: 'Scene 1',
  index: 0,
  count: 1,
  originKm: { x: 0, y: 0 },
  sizeKm: { width: 10, height: 10 },
  resolution: 1024,
  locked: false,
};

function silentLogger(errors: string[] = []): Logger {
  return {
    error: (message) => errors.push(message),
    warn: () => undefined,
    info: () => undefined,
    debug: () => undefined,
    worldMachine: () => undefined,
  };
}

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
    buildProject: {
      buildProject: async (c) => ({ state: 'finished', mode: c.mode, elapsedSeconds: 3, session: READY }),
    },
    getBuildStatus: { getBuildStatus: async () => ({ build: null, previewRunning: false, session: READY }) },
    stopBuild: { stopBuild: async () => ({ stopped: null, session: READY }) },
    listExports: {
      listExports: async () => ({
        projectFolder: '/r',
        targets: [
          {
            device: 'Height Output',
            template: '<project> <name>-<res>.png',
            path: '/r/a Height Output-257.png',
            allowed: true,
          },
        ],
        session: READY,
      }),
    },
    exportOutputs: { exportOutputs: async () => ({ files: ['/r/a Height Output-257.png'], session: READY }) },
    listSnapshots: { listSnapshots: async () => ({ snapshots: [SNAPSHOT], session: READY }) },
    createSnapshot: {
      createSnapshot: async (c) => ({ ...SNAPSHOT, name: c.name, session: READY_DIRTY }),
    },
    restoreSnapshot: {
      restoreSnapshot: async () => ({ index: 0, name: 'A', session: READY_DIRTY }),
    },
    deleteSnapshot: {
      deleteSnapshot: async () => ({ index: 0, name: 'A', remaining: [], session: READY_DIRTY }),
    },
    organizeDevices: { organizeDevices: async () => ({ session: READY_DIRTY }) },
    listGroups: { listGroups: async () => ({ groups: [TERRAIN], session: READY }) },
    setGroupEnabled: {
      setGroupEnabled: async (c) => ({ ...TERRAIN, enabled: c.enabled, session: READY_DIRTY }),
    },
    currentSession: () => READY,
    logger: silentLogger(),
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
  it('registers all thirty tools as closed-world, the nine read tools as read-only', async () => {
    const { tools } = await (await connect(deps())).listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'add_device',
      'build_project',
      'configure_scene',
      'connect_devices',
      'create_project',
      'create_snapshot',
      'delete_device',
      'delete_snapshot',
      'disconnect_devices',
      'export_outputs',
      'get_build_status',
      'get_device',
      'get_scene',
      'get_world_machine_status',
      'inspect_project',
      'list_devices',
      'list_exports',
      'list_groups',
      'list_snapshots',
      'open_project',
      'organize_devices',
      'redo',
      'rename_device',
      'restore_snapshot',
      'save_project',
      'set_device_enabled',
      'set_group_enabled',
      'stop_build',
      'undo',
      'update_device_parameters',
    ]);
    const readTools = [
      'get_build_status',
      'get_device',
      'get_scene',
      'get_world_machine_status',
      'inspect_project',
      'list_devices',
      'list_exports',
      'list_groups',
      'list_snapshots',
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

  it('states the at-least-one rule in the configure_scene and update_device_parameters descriptions', async () => {
    const { tools } = await (await connect(deps())).listTools();
    const description = (name: string) => tools.find((tool) => tool.name === name)?.description ?? '';
    expect(description('configure_scene')).toContain('give at least one');
    expect(description('update_device_parameters')).toContain('give at least one');
  });

  it('returns REFUSED, not a protocol error, for configure_scene with no fields', async () => {
    let calls = 0;
    const client = await connect(
      deps({
        configureScene: {
          configureScene: async () => {
            calls += 1;
            throw new WorldMachineError('REFUSED', 'Give at least one of name, origin, size, or resolution');
          },
        },
      }),
    );
    const result = await client.callTool({ name: 'configure_scene', arguments: {} });
    expect(calls).toBe(1);
    expect(result.isError).toBe(true);
    const content = result.content as { type: string; text: string }[];
    expect(JSON.parse(content[0]?.text ?? '')).toMatchObject({
      code: 'REFUSED',
      message: 'Give at least one of name, origin, size, or resolution',
    });
  });

  it('returns REFUSED, not a protocol error, for update_device_parameters with no parameters', async () => {
    let calls = 0;
    const client = await connect(
      deps({
        updateDeviceParameters: {
          updateDeviceParameters: async () => {
            calls += 1;
            throw new WorldMachineError('REFUSED', 'Give at least one parameter to set');
          },
        },
      }),
    );
    const result = await client.callTool({
      name: 'update_device_parameters',
      arguments: { device: '#1', parameters: {} },
    });
    expect(calls).toBe(1);
    expect(result.isError).toBe(true);
    const content = result.content as { type: string; text: string }[];
    expect(JSON.parse(content[0]?.text ?? '')).toMatchObject({
      code: 'REFUSED',
      message: 'Give at least one parameter to set',
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

  it('hides the text of an unexpected error and logs the original', async () => {
    const logged: string[] = [];
    const failing = deps({
      listDevices: {
        listDevices: async () => {
          throw new Error('boom License Manager.Checkout secret');
        },
      },
      logger: silentLogger(logged),
    });
    const result = await (await connect(failing)).callTool({ name: 'list_devices', arguments: {} });
    expect(result.isError).toBe(true);
    const serialised = JSON.stringify(result);
    expect(serialised).toContain('Internal error in list_devices; see the server log');
    expect(serialised).not.toContain('boom');
    expect(serialised).not.toContain('License');
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('list_devices');
    expect(logged[0]).toContain('boom License Manager.Checkout secret');
  });

  it('keeps licence lines in the stack of an unexpected error out of the log output', async () => {
    const written: string[] = [];
    const failing = deps({
      listDevices: {
        listDevices: async () => {
          const error = new Error('boom');
          error.stack = 'Error: boom\n    at License Manager.Checkout (seat.ts:1)\n    at run (run.ts:2)';
          throw error;
        },
      },
      logger: createLogger('debug', (chunk) => written.push(chunk)),
    });
    await (await connect(failing)).callTool({ name: 'list_devices', arguments: {} });
    const output = written.join('');
    expect(output).toContain('Unexpected error in list_devices');
    expect(output).toContain('at run (run.ts:2)');
    expect(output).not.toMatch(/licen[cs]e/i);
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

  it.each([
    ['licence lines', 'License Manager.Checkout: denied\nlicence seat lost'],
    ['log lines', '[Info       ] starting up\n[Warning    ] QIODevice::read (QSslSocket): device not open'],
  ])('omits worldMachineMessage when only %s remain to be removed', async (_name, message) => {
    const failing = deps({
      listDevices: {
        listDevices: async () => {
          throw new WorldMachineError('START_FAILED', 'exited', message);
        },
      },
    });
    const result = await (await connect(failing)).callTool({ name: 'list_devices', arguments: {} });
    const content = result.content as { type: string; text: string }[];
    const text = content[0]?.text ?? '';
    expect(JSON.parse(text)).not.toHaveProperty('worldMachineMessage');
    expect(text).not.toMatch(/licen[cs]e/i);
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

  it('returns list_devices built by parseDeviceList, including a kind row and a [disabled] row', async () => {
    const listed = parseDeviceList([
      'Devices (3 total):',
      '  #1   Gradient',
      '  #2   Easy Distortion          (Macro)',
      '  #3   Erosion [disabled]',
    ]);
    expect(listed).toEqual([
      { id: 1, name: 'Gradient', enabled: true, bypassed: false },
      { id: 2, name: 'Easy Distortion', kind: 'Macro', enabled: true, bypassed: false },
      { id: 3, name: 'Erosion', enabled: false },
    ]);
    const client = await connect(
      deps({ listDevices: { listDevices: async () => ({ devices: listed, session: READY }) } }),
    );
    const result = await client.callTool({ name: 'list_devices', arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ devices: listed, session: READY });
  });

  it('returns list_devices for the full fixture listing', async () => {
    const client = await connect(
      deps({ listDevices: { listDevices: async () => ({ devices, session: READY }) } }),
    );
    const result = await client.callTool({ name: 'list_devices', arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ devices, session: READY });
  });

  it('has nested objects to corrupt in the fixture views', () => {
    expect(erosion.inputs.some((input) => input.source !== undefined)).toBe(true);
    expect(erosion.outputs.some((output) => output.targets.length > 0)).toBe(true);
    expect(erosion.parameters.length).toBeGreaterThan(0);
    expect(project.groups.length).toBeGreaterThan(0);
    expect(project.scenes.length).toBeGreaterThan(0);
  });

  it.each([
    [
      'session.binding',
      'get_scene',
      {},
      () => ({ scene, session: { ...READY, binding: { kind: 'fresh', extra: 1 } } }),
    ],
    [
      'session.binding (opened)',
      'get_scene',
      {},
      () => ({
        scene,
        session: { state: 'ready', dirty: false, binding: { kind: 'opened', path: '/a.tmd', extra: 1 } },
      }),
    ],
    [
      'scene.originKm',
      'get_scene',
      {},
      () => ({ scene: { ...scene, originKm: { ...scene.originKm, extra: 1 } }, session: READY }),
    ],
    [
      'scene.sizeKm',
      'get_scene',
      {},
      () => ({ scene: { ...scene, sizeKm: { ...scene.sizeKm, extra: 1 } }, session: READY }),
    ],
    [
      'project.groups[0]',
      'inspect_project',
      {},
      () => ({ project: { ...project, groups: [{ ...project.groups[0], extra: 1 }] }, session: READY }),
    ],
    [
      'project.scenes[0]',
      'inspect_project',
      {},
      () => ({ project: { ...project, scenes: [{ ...project.scenes[0], extra: 1 }] }, session: READY }),
    ],
    [
      'project.devices[0]',
      'inspect_project',
      {},
      () => ({ project: { ...project, devices: [{ ...project.devices[0], extra: 1 }] }, session: READY }),
    ],
    [
      'device.parameters[0]',
      'get_device',
      { device: 'Erosion' },
      () => ({
        device: { ...erosion, parameters: [{ ...erosion.parameters[0], extra: 1 }] },
        session: READY,
      }),
    ],
    [
      'device.inputs[0].source',
      'get_device',
      { device: 'Erosion' },
      () => ({
        device: {
          ...erosion,
          inputs: [{ port: 1, name: 'In', source: { device: 'A', port: 1, extra: 1 } }],
        },
        session: READY,
      }),
    ],
    [
      'device.outputs[0].targets[0]',
      'get_device',
      { device: 'Erosion' },
      () => ({
        device: {
          ...erosion,
          outputs: [{ port: 1, name: 'Out', targets: [{ device: 'A', port: 1, extra: 1 }] }],
        },
        session: READY,
      }),
    ],
  ] as const)('rejects an undeclared key on nested %s', async (_where, name, args, bad) => {
    const tool = { get_scene: 'getScene', inspect_project: 'inspectProject', get_device: 'getDevice' }[name];
    const client = await connect(deps({ [tool]: { [tool]: async () => bad() } } as Partial<McpDependencies>));
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError).toBe(true);
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

/** Connects over in-memory pipes: unlike the HTTP handler, they carry the client's cancellation to the tool. */
async function connectInMemory(
  dependencies: McpDependencies,
  tamper?: (serverTransport: InMemoryTransport) => void,
): Promise<Client> {
  const server = createMcpServer(dependencies);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  tamper?.(serverTransport);
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '0.0.0' });
  cleanups.push(
    () => client.close(),
    () => server.close(),
  );
  await client.connect(clientTransport);
  return client;
}

describe('createMcpServer build and export tools (spec v2a section 4)', () => {
  const ANNOTATIONS = (destructive: boolean, idempotent: boolean) => ({
    readOnlyHint: false,
    destructiveHint: destructive,
    idempotentHint: idempotent,
    openWorldHint: false,
  });

  it('annotates the five tools as spec v2a section 4 says', async () => {
    const { tools } = await (await connect(deps())).listTools();
    const annotations = Object.fromEntries(tools.map((tool) => [tool.name, tool.annotations]));
    expect(annotations).toMatchObject({
      build_project: ANNOTATIONS(true, false),
      stop_build: ANNOTATIONS(false, true),
      export_outputs: ANNOTATIONS(true, false),
      get_build_status: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      list_exports: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    });
  });

  it('says in the descriptions that tiled builds and exports overwrite files', async () => {
    const { tools } = await (await connect(deps())).listTools();
    const description = (name: string) => tools.find((tool) => tool.name === name)?.description ?? '';
    expect(description('build_project')).toContain('overwriting files of the same name');
    expect(description('export_outputs')).toContain('overwritten without asking');
  });

  it('names the build refusals and the stop_build failure in the descriptions (Minor 5)', async () => {
    const { tools } = await (await connect(deps())).listTools();
    const description = (name: string) => tools.find((tool) => tool.name === name)?.description ?? '';
    expect(description('build_project')).toContain('unknown template token');
    expect(description('build_project')).toContain('exportAlways');
    expect(description('stop_build')).toContain('WM_COMMAND_FAILED');
  });

  it('describes tiled permission and stopped builds without pointing at list_exports (R1, P12-1)', async () => {
    const { tools } = await (await connect(deps())).listTools();
    const description = (name: string) => tools.find((tool) => tool.name === name)?.description ?? '';
    expect(description('build_project')).not.toContain('list_exports');
    expect(description('build_project')).toContain('<res>');
    expect(description('build_project')).toContain('stop_build is reported as finished');
    expect(description('list_exports')).not.toContain('tiled');
  });

  it('maps build_project arguments, with wait_seconds defaulting to 60 and the call signal passed on', async () => {
    const seen: BuildProjectCommand[] = [];
    const client = await connect(
      deps({
        buildProject: {
          buildProject: async (command) => {
            seen.push(command);
            return { state: 'running', mode: command.mode, elapsedSeconds: 0, session: READY };
          },
        },
      }),
    );
    await client.callTool({ name: 'build_project', arguments: { mode: 'tiled' } });
    await client.callTool({ name: 'build_project', arguments: { mode: 'preview', wait_seconds: 0 } });
    expect(seen.map(({ mode, waitSeconds }) => ({ mode, waitSeconds }))).toEqual([
      { mode: 'tiled', waitSeconds: 60 },
      { mode: 'preview', waitSeconds: 0 },
    ]);
    expect(seen[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(seen[0]?.onProgress).toBeUndefined();
  });

  it.each([
    { mode: 'fast' },
    { mode: 'full', wait_seconds: 601 },
    { mode: 'full', wait_seconds: -1 },
    { mode: 'full', wait_seconds: 1.5 },
  ])('rejects build_project arguments %j through the schema', async (args) => {
    const result = await (await connect(deps())).callTool({ name: 'build_project', arguments: args });
    expect(result.isError).toBe(true);
  });

  it('sends progress notifications with the elapsed seconds when the client asks for progress', async () => {
    const client = await connect(
      deps({
        buildProject: {
          buildProject: async (command) => {
            command.onProgress?.(5);
            command.onProgress?.(10);
            return { state: 'finished', mode: command.mode, elapsedSeconds: 12, session: READY };
          },
        },
      }),
    );
    const progress: { progress: number; total?: number }[] = [];
    await client.callTool(
      { name: 'build_project', arguments: { mode: 'full' } },
      { onprogress: ({ progress: value, total }) => progress.push({ progress: value, total }) },
    );
    expect(progress).toEqual([
      { progress: 5, total: 60 },
      { progress: 10, total: 60 },
    ]);
  });

  it('still returns the result when the progress notification cannot be sent', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      let reported = 0;
      const client = await connectInMemory(
        deps({
          buildProject: {
            buildProject: async (command) => {
              command.onProgress?.(5);
              reported += 1;
              return { state: 'finished', mode: command.mode, elapsedSeconds: 6, session: READY };
            },
          },
        }),
        (transport) => {
          const send = transport.send.bind(transport);
          transport.send = async (message, options) => {
            if ('method' in message && message.method === 'notifications/progress') {
              throw new Error('transport closed');
            }
            return send(message, options);
          };
        },
      );
      const result = await client.callTool(
        { name: 'build_project', arguments: { mode: 'full' } },
        { onprogress: () => undefined },
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(reported).toBe(1);
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({ state: 'finished', mode: 'full' });
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('aborts the wait when the client cancels the call (spec v2a section 4)', async () => {
    let aborted = false;
    const client = await connectInMemory(
      deps({
        buildProject: {
          buildProject: (command) =>
            new Promise((resolve) => {
              command.signal?.addEventListener('abort', () => {
                aborted = true;
                resolve({ state: 'running', mode: command.mode, elapsedSeconds: 1, session: READY });
              });
            }),
        },
      }),
    );
    const cancel = new AbortController();
    const call = client.callTool(
      { name: 'build_project', arguments: { mode: 'full' } },
      { signal: cancel.signal },
    );
    setTimeout(() => cancel.abort('stop'), 50);
    await expect(call).rejects.toThrow();
    await waitFor(() => aborted);
  });

  it.each([
    [
      'build_project',
      { mode: 'tiled' },
      { state: 'finished', mode: 'tiled', elapsedSeconds: 3, session: READY },
    ],
    ['get_build_status', {}, { build: null, previewRunning: false, session: READY }],
    ['stop_build', {}, { stopped: null, session: READY }],
    [
      'list_exports',
      {},
      {
        projectFolder: '/r',
        targets: [
          {
            device: 'Height Output',
            template: '<project> <name>-<res>.png',
            path: '/r/a Height Output-257.png',
            allowed: true,
          },
        ],
        session: READY,
      },
    ],
    ['export_outputs', {}, { files: ['/r/a Height Output-257.png'], session: READY }],
  ])('returns %s views as structured content that matches its output schema', async (name, args, view) => {
    const result = await (await connect(deps())).callTool({ name, arguments: args });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual(view);
  });

  it('returns the optional and nullable fields of the five views', async () => {
    const views = {
      build_project: {
        state: 'finished',
        mode: 'tiled',
        elapsedSeconds: 2,
        outputFolders: ['/r'],
        session: READY,
      },
      get_build_status: {
        build: { mode: 'full', elapsedSeconds: 30, startedBy: 'world-machine' },
        previewRunning: true,
        session: READY,
      },
      stop_build: { stopped: 'preview', session: READY },
      list_exports: {
        projectFolder: null,
        targets: [
          {
            device: 'Height Output',
            template: '<project> <name>-<res>.png',
            path: null,
            allowed: false,
            reason: 'The project has never been saved',
          },
        ],
        session: READY,
      },
      export_outputs: { files: ['/r/a.png'], note: 'A Material Output writes four files', session: READY },
    } as const;
    const client = await connect(
      deps({
        buildProject: { buildProject: async () => views.build_project },
        getBuildStatus: { getBuildStatus: async () => views.get_build_status },
        stopBuild: { stopBuild: async () => views.stop_build },
        listExports: { listExports: async () => views.list_exports },
        exportOutputs: { exportOutputs: async () => views.export_outputs },
      }),
    );
    for (const [name, args] of [
      ['build_project', { mode: 'tiled' }],
      ['get_build_status', {}],
      ['stop_build', {}],
      ['list_exports', {}],
      ['export_outputs', {}],
    ] as const) {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError, name).toBeFalsy();
      expect(result.structuredContent, name).toEqual(views[name]);
    }
  });

  it('returns mode unknown for a build World Machine started (spec v2a section 4)', async () => {
    const client = await connect(
      deps({
        getBuildStatus: {
          getBuildStatus: async () => ({
            build: { mode: 'unknown', elapsedSeconds: 1, startedBy: 'world-machine' },
            previewRunning: false,
            session: READY,
          }),
        },
        stopBuild: { stopBuild: async () => ({ stopped: 'unknown', session: READY }) },
      }),
    );
    const status = await client.callTool({ name: 'get_build_status', arguments: {} });
    expect(status.isError).toBeFalsy();
    expect(status.structuredContent).toMatchObject({
      build: { mode: 'unknown', startedBy: 'world-machine' },
    });
    const stop = await client.callTool({ name: 'stop_build', arguments: {} });
    expect(stop.isError).toBeFalsy();
    expect(stop.structuredContent).toMatchObject({ stopped: 'unknown' });
  });

  it('rejects a build view with a field the output schema does not declare', async () => {
    const client = await connect(
      deps({
        buildProject: {
          buildProject: async () =>
            ({
              state: 'finished',
              mode: 'full',
              elapsedSeconds: 1,
              session: READY,
              extra: 1,
            }) as unknown as Awaited<ReturnType<McpDependencies['buildProject']['buildProject']>>,
        },
      }),
    );
    const result = await client.callTool({ name: 'build_project', arguments: { mode: 'full' } });
    expect(result.isError).toBe(true);
  });
});

describe('createMcpServer snapshot, organize, and group tools (spec v2b section 3)', () => {
  const ANNOTATIONS = (destructive: boolean, idempotent: boolean) => ({
    readOnlyHint: false,
    destructiveHint: destructive,
    idempotentHint: idempotent,
    openWorldHint: false,
  });
  const READ = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

  it('annotates the seven tools as spec v2b section 3 says, and keeps build_project as it was', async () => {
    const { tools } = await (await connect(deps())).listTools();
    const annotations = Object.fromEntries(tools.map((tool) => [tool.name, tool.annotations]));
    expect(annotations).toMatchObject({
      list_snapshots: READ,
      create_snapshot: ANNOTATIONS(false, false),
      restore_snapshot: ANNOTATIONS(true, false),
      delete_snapshot: ANNOTATIONS(true, false),
      organize_devices: ANNOTATIONS(false, true),
      list_groups: READ,
      set_group_enabled: ANNOTATIONS(false, true),
      build_project: ANNOTATIONS(true, false),
    });
  });

  it('says what the spec asks in the descriptions', async () => {
    const { tools } = await (await connect(deps())).listTools();
    const description = (name: string) => tools.find((tool) => tool.name === name)?.description ?? '';
    for (const name of ['list_snapshots', 'create_snapshot', 'restore_snapshot', 'delete_snapshot']) {
      expect(description(name), name).toContain('checkpoint');
      expect(description(name), name).toContain('variant');
    }
    expect(description('create_snapshot')).toContain('stored in the project file');
    expect(description('create_snapshot')).toContain('save_project');
    expect(description('create_snapshot')).toContain('already has');
    expect(description('restore_snapshot')).toContain('One undo reverts the restore');
    expect(description('set_group_enabled')).toContain("each member device's own enabled state");
    expect(description('set_group_enabled')).toContain('disabled one by one');
    expect(description('set_group_enabled')).toContain('One undo reverts the whole group');
    expect(description('set_group_enabled')).toContain('deviceCount is 0');
    expect(description('list_groups')).toContain('World Machine window');
    expect(description('list_groups')).toContain('the header keeps the full count');
    expect(description('build_project')).toContain('does not make the outputs exportable');
    expect(description('build_project')).toContain('list_groups');
  });

  it('says that only an index-like snapshot name needs its #<index> (final review F1)', async () => {
    const { tools } = await (await connect(deps())).listTools();
    const description = (name: string) => tools.find((tool) => tool.name === name)?.description ?? '';
    for (const name of ['restore_snapshot', 'delete_snapshot']) {
      expect(description(name), name).toContain(
        'A name of the form #<n> is read as an index, so a snapshot whose name looks like that is reached by its #<index>.',
      );
      expect(description(name), name).not.toContain('ends in spaces');
    }
    expect(description('set_group_enabled')).toContain('or ends in spaces, is reached by its #<index>');
  });

  it('maps the arguments to query and command objects', async () => {
    const seen: unknown[] = [];
    const client = await connect(
      deps({
        createSnapshot: {
          createSnapshot: async (c) => {
            seen.push(c);
            return { ...SNAPSHOT, name: c.name, session: READY_DIRTY };
          },
        },
        restoreSnapshot: {
          restoreSnapshot: async (c) => {
            seen.push(c);
            return { index: 0, name: 'A', session: READY_DIRTY };
          },
        },
        deleteSnapshot: {
          deleteSnapshot: async (c) => {
            seen.push(c);
            return { index: 0, name: 'A', remaining: [], session: READY_DIRTY };
          },
        },
        listGroups: {
          listGroups: async (q) => {
            seen.push(q);
            return { groups: [], session: READY };
          },
        },
        setGroupEnabled: {
          setGroupEnabled: async (c) => {
            seen.push(c);
            return { ...TERRAIN, enabled: c.enabled, session: READY_DIRTY };
          },
        },
        buildProject: {
          buildProject: async (c) => {
            seen.push({ mode: c.mode, group: c.group, waitSeconds: c.waitSeconds });
            return { state: 'finished', mode: c.mode, elapsedSeconds: 1, group: TERRAIN, session: READY };
          },
        },
      }),
    );
    for (const [name, args] of [
      ['create_snapshot', { name: 'erosion a' }],
      ['restore_snapshot', { snapshot: '#0' }],
      ['delete_snapshot', { snapshot: 'erosion a' }],
      ['list_groups', {}],
      ['list_groups', { filter: 'Terrain' }],
      ['set_group_enabled', { group: 'Create your Terrain', enabled: false }],
      ['build_project', { mode: 'group', group: '#0' }],
    ] as const) {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError, name).toBeFalsy();
    }
    expect(seen).toEqual([
      { name: 'erosion a' },
      { snapshot: '#0' },
      { snapshot: 'erosion a' },
      {},
      { filter: 'Terrain' },
      { group: 'Create your Terrain', enabled: false },
      { mode: 'group', group: '#0', waitSeconds: 60 },
    ]);
  });

  it.each([
    ['create_snapshot', {}],
    ['create_snapshot', { name: '' }],
    ['restore_snapshot', {}],
    ['delete_snapshot', { snapshot: '' }],
    ['list_groups', { filter: '' }],
    ['set_group_enabled', { group: '#0' }],
    ['set_group_enabled', { group: '', enabled: true }],
    ['build_project', { mode: 'group', group: '' }],
    ['build_project', { mode: 'groups' }],
  ])('rejects %s arguments %j through the schema', async (name, args) => {
    const result = await (await connect(deps())).callTool({ name, arguments: args });
    expect(result.isError).toBe(true);
  });

  it('returns each view as structured content, with the views the parsers build from the captures', async () => {
    const snapshots = parseSnapshotList(rawFrame('v2b-snapshots.txt', 'snapshot list', 3));
    const groups = parseGroupList(rawFrame('v2b-groups.txt', 'group list'));
    const views = {
      list_snapshots: { snapshots, session: READY },
      create_snapshot: { index: 4, name: 'erosion a', created: '2026-10-06 11:09', session: READY_DIRTY },
      restore_snapshot: { index: 1, name: 'B with space', session: READY_DIRTY },
      delete_snapshot: {
        index: 1,
        name: 'B with space',
        remaining: parseSnapshotList(rawFrame('v2b-snapshots.txt', 'snapshot list', 7)),
        session: READY_DIRTY,
      },
      organize_devices: { session: READY_DIRTY },
      list_groups: { groups, session: READY },
      set_group_enabled: {
        index: 3,
        name: 'Welcome to World Machine!',
        deviceCount: 0,
        enabled: true,
        session: READY,
      },
      build_project: { state: 'running', mode: 'group', elapsedSeconds: 0, group: TERRAIN, session: READY },
    } as const;
    const client = await connect(
      deps({
        listSnapshots: { listSnapshots: async () => views.list_snapshots },
        createSnapshot: { createSnapshot: async () => views.create_snapshot },
        restoreSnapshot: { restoreSnapshot: async () => views.restore_snapshot },
        deleteSnapshot: { deleteSnapshot: async () => views.delete_snapshot },
        organizeDevices: { organizeDevices: async () => views.organize_devices },
        listGroups: { listGroups: async () => views.list_groups },
        setGroupEnabled: { setGroupEnabled: async () => views.set_group_enabled },
        buildProject: { buildProject: async () => views.build_project },
      }),
    );
    for (const [name, args] of [
      ['list_snapshots', {}],
      ['create_snapshot', { name: 'erosion a' }],
      ['restore_snapshot', { snapshot: 'B with space' }],
      ['delete_snapshot', { snapshot: '#1' }],
      ['organize_devices', {}],
      ['list_groups', {}],
      ['set_group_enabled', { group: '#3', enabled: true }],
      ['build_project', { mode: 'group', group: '#0', wait_seconds: 0 }],
    ] as const) {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError, name).toBeFalsy();
      expect(result.structuredContent, name).toEqual(views[name]);
    }
  });

  it.each([
    [
      'restore_snapshot',
      { snapshot: '#0' },
      { restoreSnapshot: { restoreSnapshot: async () => ({ ...SNAPSHOT, session: READY }) } },
    ],
    [
      'set_group_enabled',
      { group: '#0', enabled: true },
      {
        setGroupEnabled: {
          setGroupEnabled: async () => ({ ...TERRAIN, enabled: true, changed: true, session: READY }),
        },
      },
    ],
    [
      'list_groups',
      {},
      { listGroups: { listGroups: async () => ({ groups: [{ ...TERRAIN, members: [] }], session: READY }) } },
    ],
  ])('rejects a %s view with a field the output schema does not declare', async (name, args, override) => {
    const client = await connect(deps(override as unknown as Partial<McpDependencies>));
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError).toBe(true);
  });
});

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

type Loose = Record<string, unknown>;

const SESSION_SHAPES: readonly [string, SessionSummary][] = [
  ['ready, fresh, clean', { state: 'ready', binding: { kind: 'fresh' }, dirty: false }],
  ['ready, fresh, dirty', { state: 'ready', binding: { kind: 'fresh' }, dirty: true }],
  ['ready, opened, clean', { state: 'ready', binding: { kind: 'opened', path: '/r/a.tmd' }, dirty: false }],
  ['ready, opened, dirty', { state: 'ready', binding: { kind: 'opened', path: '/r/a.tmd' }, dirty: true }],
  ['notRunning', { state: 'notRunning' }],
  ['starting', { state: 'starting' }],
  ['unhealthy with a reason', { state: 'unhealthy', reason: 'World Machine exited unexpectedly' }],
  ['stopping', { state: 'stopping' }],
];

describe('createMcpServer session summary shapes', () => {
  it.each(SESSION_SHAPES)(
    'returns undo and get_world_machine_status views with session %s',
    async (_label, session) => {
      const client = await connect(
        deps({
          undo: { undo: async () => ({ session }) },
          getStatus: {
            getStatus: async () => ({ configured: false, executable: null, session }),
          },
        }),
      );
      const undone = await client.callTool({ name: 'undo', arguments: {} });
      expect(undone.isError).toBeFalsy();
      expect(undone.structuredContent).toEqual({ session });
      const status = await client.callTool({ name: 'get_world_machine_status', arguments: {} });
      expect(status.isError).toBeFalsy();
      expect(status.structuredContent).toEqual({ configured: false, executable: null, session });
    },
  );

  it('returns open_project with an opened-binding session and its path', async () => {
    const session: SessionSummary = {
      state: 'ready',
      binding: { kind: 'opened', path: '/r/a.tmd' },
      dirty: false,
    };
    const client = await connect(
      deps({ openProject: { openProject: async (c) => ({ session, path: c.path }) } }),
    );
    const result = await client.callTool({ name: 'open_project', arguments: { path: '/r/a.tmd' } });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ session, path: '/r/a.tmd' });
  });

  it.each([
    ['get_world_machine_status', {}, 'getStatus', 'getStatus'],
    ['list_devices', {}, 'listDevices', 'listDevices'],
    ['get_device', { device: '#1' }, 'getDevice', 'getDevice'],
    ['get_scene', {}, 'getScene', 'getScene'],
    ['inspect_project', {}, 'inspectProject', 'inspectProject'],
    ['undo', {}, 'undo', 'undo'],
    ['redo', {}, 'redo', 'redo'],
    ['create_project', {}, 'createProject', 'createProject'],
    ['save_project', {}, 'saveProject', 'saveProject'],
    ['open_project', { path: '/r/a.tmd' }, 'openProject', 'openProject'],
  ] as const)(
    'rejects %s output with an undeclared key at the top and inside the session',
    async (name, args, dep, method) => {
      const base = deps();
      const port = base[dep] as unknown as Record<
        string,
        (query: object) => Promise<Record<string, unknown>>
      >;
      const view = await port[method]?.({});
      const top = { ...view, extra: 1 };
      const nested = { ...view, session: { ...(view?.session as object), extra: 1 } };
      for (const bad of [top, nested]) {
        const client = await connect(
          deps({ [dep]: { [method]: async () => bad } } as Partial<McpDependencies>),
        );
        const result = await client.callTool({ name, arguments: args });
        expect(result.isError).toBe(true);
      }
    },
  );

  it.each([
    [
      'get_device',
      { device: '#1' },
      (view: Loose) => ({ device: { ...(view.device as object), extra: 1 }, session: view.session }),
      'getDevice',
    ],
    [
      'get_scene',
      {},
      (view: Loose) => ({ scene: { ...(view.scene as object), extra: 1 }, session: view.session }),
      'getScene',
    ],
    [
      'inspect_project',
      {},
      (view: Loose) => ({ project: { ...(view.project as object), extra: 1 }, session: view.session }),
      'inspectProject',
    ],
    [
      'list_devices',
      {},
      (view: Loose) => ({ devices: [{ ...(view.devices as object[])[0], extra: 1 }], session: view.session }),
      'listDevices',
    ],
  ] as const)(
    'rejects %s output with an undeclared key inside the payload',
    async (name, args, corrupt, dep) => {
      const base = deps();
      const port = base[dep] as unknown as Record<string, (query: object) => Promise<Loose>>;
      const bad = corrupt((await port[dep]?.({})) ?? {});
      const client = await connect(deps({ [dep]: { [dep]: async () => bad } } as Partial<McpDependencies>));
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError).toBe(true);
    },
  );
});
