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
import { NOT_BUILT_HINT } from '../../../../src/domain/build-result.js';
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
const PLAN_ID = '3f9a12345678'.padEnd(64, '0');
const GRAPH_SPEC = { version: 1, devices: [{ name: 'Base', type: 'Advanced Perlin' }] };

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
          portTypes: 'unknown',
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
    setDeviceBypassed: {
      setDeviceBypassed: async (c) => ({
        device: { id: 1, name: 'Gradient' },
        bypassed: c.bypassed,
        changed: true,
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
    planGraph: {
      planGraph: async () => ({
        planId: PLAN_ID,
        conflicts: [],
        steps: [],
        unchanged: [],
        uncheckedWires: [],
        unidentifiableWires: [],
        session: READY,
      }),
    },
    applyGraph: {
      applyGraph: async () => ({
        applied: 0,
        snapshot: null,
        diff: [],
        unidentifiableWires: [],
        session: READY,
      }),
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
  it('registers all thirty-three tools as closed-world, the ten read tools as read-only', async () => {
    const { tools } = await (await connect(deps())).listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'add_device',
      'apply_graph',
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
      'plan_graph',
      'redo',
      'rename_device',
      'restore_snapshot',
      'save_project',
      'set_device_bypassed',
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
      'plan_graph',
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

  it('marks apply_graph destructive and not idempotent, and plan_graph read-only', async () => {
    const { tools } = await (await connect(deps())).listTools();
    const annotations = (name: string) => tools.find((tool) => tool.name === name)?.annotations;
    expect(annotations('apply_graph')).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    });
    expect(annotations('plan_graph')).toMatchObject({ readOnlyHint: true });
    const description = tools.find((tool) => tool.name === 'apply_graph')?.description ?? '';
    expect(description).toContain('show the plan to the user');
    expect(description).toContain('Float and enum parameters are always set');
    expect(description).toContain('undo does not revert');
  });

  it('accepts bypassed in a graph spec device and describes it on plan_graph', async () => {
    const specs: unknown[] = [];
    const client = await connect(
      deps({
        planGraph: {
          planGraph: async (query) => {
            specs.push(query.spec);
            return {
              planId: PLAN_ID,
              conflicts: [],
              steps: [],
              unchanged: [],
              uncheckedWires: [],
              unidentifiableWires: [],
              session: READY,
            };
          },
        },
      }),
    );
    const spec = { version: 1, devices: [{ name: 'Base', type: 'Gradient', bypassed: true }] };
    const result = await client.callTool({ name: 'plan_graph', arguments: { spec } });
    expect(result.isError).toBeFalsy();
    expect(specs).toEqual([spec]);
    const { tools } = await client.listTools();
    const description = tools.find((tool) => tool.name === 'plan_graph')?.description ?? '';
    expect(description).toContain('enabled?, bypassed?');
    expect(description).toContain('bypassed is set, not toggled');
  });

  it('accepts id in a graph spec device and describes ids and shared wire sources (revision 6)', async () => {
    const specs: unknown[] = [];
    const client = await connect(
      deps({
        planGraph: {
          planGraph: async (query) => {
            specs.push(query.spec);
            return {
              planId: PLAN_ID,
              conflicts: [],
              steps: [],
              unchanged: [],
              uncheckedWires: [],
              unidentifiableWires: [],
              session: READY,
            };
          },
        },
      }),
    );
    const spec = { version: 1, devices: [{ name: 'hills mix', id: 536, type: 'Combiner' }] };
    const result = await client.callTool({ name: 'plan_graph', arguments: { spec } });
    expect(result.isError).toBeFalsy();
    expect(specs).toEqual([spec]);
    const { tools } = await client.listTools();
    const description = (name: string) => tools.find((tool) => tool.name === name)?.description ?? '';
    expect(description('plan_graph')).toContain('{ name, id?, type, enabled?, bypassed?');
    expect(description('plan_graph')).toContain('add_device and give its id');
    expect(description('apply_graph')).toContain('never added or renamed');
    for (const name of ['connect_devices', 'disconnect_devices']) {
      expect(description(name)).toContain('naming their ids');
      expect(description(name)).not.toContain('rename');
    }
  });

  it.each([
    ['get_device', 'lists its options in index order'],
    ['get_device', 'enumOptionsNote'],
    ['get_device', 'describes devices as device add creates them'],
    ['update_device_parameters', 'a row without options has its reason in enumOptionsNote'],
    ['update_device_parameters', 'finding an index by setting values makes unsaved changes'],
    ['update_device_parameters', "the 0-based index of their label in get_device's options"],
    ['plan_graph', 'the 0-based index of its label in the options get_device lists'],
  ])('names enum options in the %s description: %s', async (name, text) => {
    const { tools } = await (await connect(deps())).listTools();
    expect(tools.find((tool) => tool.name === name)?.description ?? '').toContain(text);
  });

  it.each([
    'Each output shows its port type (type) and each input the types it accepts (accepts) when portTypes is catalogued',
    'otherwise portTypes is unknown and the port types are left out',
  ])('describes port types in get_device: %s', async (text) => {
    const { tools } = await (await connect(deps())).listTools();
    expect(tools.find((tool) => tool.name === 'get_device')?.description ?? '').toContain(text);
  });

  it('describes port types in connect_devices (port-types design section 6)', async () => {
    const { tools } = await (await connect(deps())).listTools();
    expect(tools.find((tool) => tool.name === 'connect_devices')?.description ?? '').toContain(
      "Port types are not checked before connecting; when World Machine refuses a wire as incompatible types and both devices have catalogued port types (see get_device), the error names the output's type and the types the input accepts.",
    );
  });

  it.each([
    'A wire whose output port type the input does not accept is a conflict when both devices have catalogued port types',
    'a wire with an end whose port types are unknown is listed in uncheckedWires and not checked',
    'another fed combination rests on the unconnected device, and connect_devices can still try such a wire',
  ])('describes port types in plan_graph: %s', async (text) => {
    const { tools } = await (await connect(deps())).listTools();
    expect(tools.find((tool) => tool.name === 'plan_graph')?.description ?? '').toContain(text);
  });

  it('refuses a plan view without uncheckedWires (port-types design section 6)', async () => {
    const view = {
      planId: PLAN_ID,
      conflicts: [],
      steps: [],
      unchanged: [],
      unidentifiableWires: [],
      session: READY,
    };
    const client = await connect(deps({ planGraph: { planGraph: async () => view as never } }));
    const result = await client.callTool({ name: 'plan_graph', arguments: { spec: GRAPH_SPEC } });
    expect(result.isError).toBe(true);
  });

  it('refuses a plan view without unidentifiableWires (unidentifiable-wires design section 4)', async () => {
    const view = {
      planId: PLAN_ID,
      conflicts: [],
      steps: [],
      unchanged: [],
      uncheckedWires: [],
      session: READY,
    };
    const client = await connect(deps({ planGraph: { planGraph: async () => view as never } }));
    const result = await client.callTool({ name: 'plan_graph', arguments: { spec: GRAPH_SPEC } });
    expect(result.isError).toBe(true);
  });

  it('refuses an apply view without unidentifiableWires (unidentifiable-wires design section 4)', async () => {
    const view = { applied: 0, snapshot: null, diff: [], session: READY };
    const client = await connect(deps({ applyGraph: { applyGraph: async () => view as never } }));
    const result = await client.callTool({
      name: 'apply_graph',
      arguments: { spec: GRAPH_SPEC, plan_id: PLAN_ID },
    });
    expect(result.isError).toBe(true);
  });

  it('describes unidentifiableWires on plan_graph and apply_graph, not the old warning', async () => {
    const { tools } = await (await connect(deps())).listTools();
    const description = (name: string) => tools.find((tool) => tool.name === name)?.description ?? '';
    expect(description('plan_graph')).toContain(
      'unidentifiableWires lists each wire into a managed device that the plan would leave unidentifiable',
    );
    expect(description('plan_graph')).toContain('a later plan reports that input as a conflict');
    expect(description('plan_graph')).not.toContain('can itself create a wiring');
    expect(description('apply_graph')).toContain(
      "The result repeats the plan's unidentifiableWires, the wires into managed devices that a later plan cannot identify.",
    );
  });

  it('passes plan_id and keep_snapshot to apply_graph, keep_snapshot false by default', async () => {
    const commands: unknown[] = [];
    const client = await connect(
      deps({
        applyGraph: {
          applyGraph: async (command) => {
            commands.push(command);
            return { applied: 0, snapshot: null, diff: [], unidentifiableWires: [], session: READY };
          },
        },
      }),
    );
    await client.callTool({ name: 'apply_graph', arguments: { spec: GRAPH_SPEC, plan_id: PLAN_ID } });
    await client.callTool({
      name: 'apply_graph',
      arguments: { spec: GRAPH_SPEC, plan_id: PLAN_ID, keep_snapshot: true },
    });
    expect(commands).toEqual([
      { spec: GRAPH_SPEC, planId: PLAN_ID, keepSnapshot: false },
      { spec: GRAPH_SPEC, planId: PLAN_ID, keepSnapshot: true },
    ]);
  });

  it('refuses a plan view whose set-bypassed step carries a field the schema does not know', async () => {
    const view = {
      planId: PLAN_ID,
      conflicts: [],
      steps: [{ op: 'set-bypassed', device: 'Base', to: true, toggle: true }],
      unchanged: [],
      uncheckedWires: [],
      unidentifiableWires: [],
      session: READY,
    };
    const client = await connect(deps({ planGraph: { planGraph: async () => view as never } }));
    const result = await client.callTool({ name: 'plan_graph', arguments: { spec: GRAPH_SPEC } });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
  });

  it('returns a plan with every step kind as structured content', async () => {
    const view = {
      planId: PLAN_ID,
      conflicts: [{ entry: 'Eroded', reason: "#20 has no parameter 'Steps'" }],
      steps: [
        {
          op: 'disconnect',
          device: 'Eroded',
          id: 20,
          port: 1,
          from: 'Old.1',
          source: { device: 'Old', id: 12, port: 1 },
        },
        { op: 'remove', device: 'Old', id: 12, wiresRemoved: ['Old.1 -> Eroded.1'] },
        { op: 'add', device: 'Base', type: 'Advanced Perlin' },
        { op: 'set-enabled', device: 'Eroded', id: 20, from: true, to: false },
        { op: 'set-bypassed', device: 'Eroded', id: 20, from: false, to: true },
        { op: 'set-bypassed', device: 'Base', to: true },
        { op: 'set-parameter', device: 'Base', name: 'scale', to: '0.4', comparable: false },
        {
          op: 'connect',
          device: 'Eroded',
          id: 20,
          port: 1,
          from: 'Base.1',
          source: { device: 'Base', port: 1 },
        },
      ],
      unchanged: ['Shape'],
      uncheckedWires: ["'Eroded' input 1"],
      unidentifiableWires: [
        "'Eroded' input 1 from 'Combiner' output 1: #536, #537 each list 'Erosion' input 1",
      ],
      session: READY,
    } as const;
    const client = await connect(deps({ planGraph: { planGraph: async () => view } }));
    const result = await client.callTool({ name: 'plan_graph', arguments: { spec: GRAPH_SPEC } });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual(view);
  });

  it('returns an apply diff with every change kind as structured content', async () => {
    const view = {
      applied: 5,
      snapshot: null,
      diff: [
        {
          device: 'Base',
          change: 'added',
          after: {
            id: 536,
            type: 'Advanced Perlin',
            enabled: true,
            bypassed: true,
            parameters: { scale: '4 km' },
            inputs: { '1': 'Shape.1' },
          },
        },
        { device: 'Old', change: 'removed', before: { id: 12, type: 'Perlin Noise' } },
        {
          device: 'Eroded',
          change: 'changed',
          id: 20,
          bypassed: { before: false, after: true },
          parameters: { steps: { before: '4', after: '6' } },
          inputs: { '1': { before: 'Old.1', after: 'Base.1' } },
        },
      ],
      unidentifiableWires: [],
      session: READY_DIRTY,
    } as const;
    const client = await connect(deps({ applyGraph: { applyGraph: async () => view } }));
    const result = await client.callTool({
      name: 'apply_graph',
      arguments: { spec: GRAPH_SPEC, plan_id: PLAN_ID },
    });
    expect(result.structuredContent).toEqual(view);
  });

  it('round-trips an apply_graph view with diffError', async () => {
    const view = {
      applied: 2,
      snapshot: 'apply_graph 3f9a12345678',
      diff: [],
      diffError: 'read failed',
      unidentifiableWires: [
        "'Eroded' input 1 from 'Combiner' output 1: #536, #537 each list 'Erosion' input 1",
      ],
      session: READY_DIRTY,
    } as const;
    const client = await connect(deps({ applyGraph: { applyGraph: async () => view } }));
    const result = await client.callTool({
      name: 'apply_graph',
      arguments: { spec: GRAPH_SPEC, plan_id: PLAN_ID },
    });
    expect(result.structuredContent).toEqual(view);
  });

  it('reports APPLY_FAILED with its details beside code and message', async () => {
    const details = {
      failedStep: {
        index: 2,
        step: { op: 'set-parameter', device: 'Base', name: 'nope', to: '1', comparable: false },
        code: 'REFUSED',
        message: "Nothing was set on #536 'Base'",
      },
      completedSteps: 2,
      rolledBack: true,
      snapshot: 'apply_graph 3f9a12345678',
    };
    const client = await connect(
      deps({
        applyGraph: {
          applyGraph: async () => {
            throw new WorldMachineError('APPLY_FAILED', 'Step 3 of 4 failed', undefined, details);
          },
        },
      }),
    );
    const result = await client.callTool({
      name: 'apply_graph',
      arguments: { spec: GRAPH_SPEC, plan_id: PLAN_ID },
    });
    expect(result.isError).toBe(true);
    const content = result.content as { type: string; text: string }[];
    expect(JSON.parse(content[0]?.text ?? '')).toEqual({
      code: 'APPLY_FAILED',
      message: 'Step 3 of 4 failed',
      ...details,
      session: READY,
    });
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

  it('returns the status of a project recovered from a crashed session', async () => {
    const session = { state: 'ready', binding: { kind: 'fresh' }, dirty: true, recovered: true } as const;
    const result = await (
      await connect(
        deps({
          getStatus: { getStatus: async () => ({ configured: true, executable: '/opt/wm', session }) },
        }),
      )
    ).callTool({ name: 'get_world_machine_status', arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ configured: true, executable: '/opt/wm', session });
  });

  it('rejects a recovered flag other than true through the strict output schema', async () => {
    const session = { state: 'ready', binding: { kind: 'fresh' }, dirty: false, recovered: false };
    const result = await (
      await connect(
        deps({
          getStatus: {
            getStatus: async () =>
              ({ configured: true, executable: '/opt/wm', session }) as unknown as Awaited<
                ReturnType<McpDependencies['getStatus']['getStatus']>
              >,
          },
        }),
      )
    ).callTool({ name: 'get_world_machine_status', arguments: {} });
    expect(result.isError).toBe(true);
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

  it('rejects a misspelled spec key through the schema without reaching the port', async () => {
    let calls = 0;
    const client = await connect(
      deps({
        planGraph: {
          planGraph: async () => {
            calls += 1;
            return {
              planId: PLAN_ID,
              conflicts: [],
              steps: [],
              unchanged: [],
              uncheckedWires: [],
              unidentifiableWires: [],
              session: READY,
            };
          },
        },
      }),
    );
    const result = await client.callTool({
      name: 'plan_graph',
      arguments: {
        spec: { version: 1, devices: [{ name: 'Base', type: 'Gradient', paramters: { octaves: 8 } }] },
      },
    });
    expect(result.isError).toBe(true);
    expect(calls).toBe(0);
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
    portTypes: 'unknown',
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

  // raw/enum-options.txt l.1557-1559 and l.1572-1632: a new Combiner's rows and Method's options.
  const combinerWithOptions: DeviceDetail = {
    id: 559,
    name: 'Combiner',
    type: 'Combiner',
    enabled: true,
    bypassed: false,
    parameters: [
      {
        name: 'Method',
        type: 'enum',
        value: 'Average',
        options: [
          'Average',
          'Add',
          'Subtract',
          'Multiply',
          'Max',
          'Min',
          'Power',
          'Root',
          'Detail',
          'Differences',
          'Screen',
        ],
      },
      { name: 'Strength', type: 'float', value: '0.5' },
    ],
    inputs: [
      { port: 1, name: 'Primary Input' },
      { port: 2, name: 'Primary Input' },
    ],
    outputs: [{ port: 1, name: 'Primary Output', targets: [] }],
    portTypes: 'unknown',
  };

  // One test per case, so a failure of the first does not hide the second (round ruling 4).
  it.each<[string, DeviceDetail]>([
    ['enum options on a parameter row', combinerWithOptions],
    // Spec section 2: the sample Erosion's soilMask has no catalog entry, since a new Erosion has no enum (l.8158).
    [
      'enumOptionsNote on the device',
      { ...erosion, enumOptionsNote: ["no enum options known for type 'Erosion'"] },
    ],
  ])('returns get_device with %s through the strict schema', async (_label, device) => {
    const client = await connect(
      deps({ getDevice: { getDevice: async () => ({ device, session: READY }) } }),
    );
    const result = await client.callTool({ name: 'get_device', arguments: { device: '#1' } });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ device, session: READY });
  });

  it('refuses a get_device view without portTypes (port-types design section 6, Codex round 1 ruling S1)', async () => {
    const { portTypes: _omitted, ...device } = erosion;
    const client = await connect(
      deps({ getDevice: { getDevice: async () => ({ device, session: READY }) as never } }),
    );
    const result = await client.callTool({ name: 'get_device', arguments: { device: '#35' } });
    expect(result.isError).toBe(true);
  });

  // raw/create-water.txt l.122-133, typed with the synthetic classes of test/support/port-types.ts.
  const typedCreateWater: DeviceDetail = {
    id: 536,
    name: 'Create Water',
    type: 'Create Water',
    enabled: true,
    bypassed: false,
    parameters: [],
    inputs: [
      { port: 1, name: 'Terrain', accepts: ['heightfield'] },
      { port: 2, name: 'Existing Water', accepts: ['water system'] },
      { port: 3, name: 'Precipitation Map', accepts: ['heightfield'] },
    ],
    outputs: [
      { port: 1, name: 'Terrain', targets: [], type: 'heightfield' },
      { port: 2, name: 'Water System', targets: [], type: 'water system' },
      { port: 3, name: 'Tributary Mask', targets: [], type: 'heightfield' },
      { port: 4, name: 'Lake Mask', targets: [], type: 'heightfield' },
    ],
    portTypes: 'catalogued',
  };

  it('returns get_device with catalogued port types through the strict schema (port-types design section 6)', async () => {
    const device = typedCreateWater;
    const client = await connect(
      deps({ getDevice: { getDevice: async () => ({ device, session: READY }) } }),
    );
    const result = await client.callTool({ name: 'get_device', arguments: { device: '#536' } });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ device, session: READY });
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
      set_device_bypassed: ANNOTATIONS(false, true),
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

  it.each([
    'also takes a length such as "500 m"',
    'setting the parameter to 1 and undoing that set',
    "World Machine's display rounding",
    'A plain number is always an internal value',
    'an item whose scale was read reports given and scale',
    'the probe marks the project unsaved even after its undo',
    'when every length item is rejected after its probe, do not use redo before another edit',
  ])('describes lengths in update_device_parameters: %s', async (text) => {
    const { tools } = await (await connect(deps())).listTools();
    expect(tools.find((tool) => tool.name === 'update_device_parameters')?.description ?? '').toContain(text);
  });

  it('describes lengths in the update_device_parameters input schema', async () => {
    const { tools } = await (await connect(deps())).listTools();
    const tool = tools.find((candidate) => candidate.name === 'update_device_parameters');
    expect(JSON.stringify(tool?.inputSchema)).toContain('a length in m or km such as 500 m');
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
    ['set_device_bypassed', { device: '#1', bypassed: true }],
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

  it('admits given and scale in update_device_parameters items (float-units design section 5)', async () => {
    const client = await connect(
      deps({
        updateDeviceParameters: {
          updateDeviceParameters: async () => ({
            device: { id: 1, name: 'Gradient' },
            parameters: [
              {
                name: 'Width',
                type: 'float',
                requested: '0.0625',
                outcome: 'applied',
                value: '500 m',
                given: '500 m',
                scale: '8 km',
              },
            ],
            session: READY_DIRTY,
          }),
        },
      }),
    );
    const result = await client.callTool({
      name: 'update_device_parameters',
      arguments: { device: '#1', parameters: { Width: '500 m' } },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ parameters: [{ given: '500 m', scale: '8 km' }] });
  });

  it('admits the output check fields in build_project (build-not-built design section 5)', async () => {
    const client = await connect(
      deps({
        buildProject: {
          buildProject: async () => ({
            state: 'finished',
            mode: 'full',
            elapsedSeconds: 3,
            outputsBuilt: false,
            notBuilt: [{ id: 3, name: 'Height Output' }],
            stoppedAt: [{ id: 2, name: 'River', type: 'River', enabled: true, bypassed: false }],
            hint: NOT_BUILT_HINT,
            session: READY,
          }),
        },
      }),
    );
    const result = await client.callTool({ name: 'build_project', arguments: { mode: 'full' } });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      outputsBuilt: false,
      notBuilt: [{ id: 3, name: 'Height Output' }],
      stoppedAt: [{ id: 2, name: 'River', type: 'River', enabled: true, bypassed: false }],
      hint: NOT_BUILT_HINT,
    });
  });

  it('admits outputsCheckError in build_project (build-not-built design section 6)', async () => {
    const client = await connect(
      deps({
        buildProject: {
          buildProject: async () => ({
            state: 'finished',
            mode: 'full',
            elapsedSeconds: 3,
            outputsCheckError: 'World Machine rejected "device select #1"',
            session: READY,
          }),
        },
      }),
    );
    const result = await client.callTool({ name: 'build_project', arguments: { mode: 'full' } });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      outputsCheckError: 'World Machine rejected "device select #1"',
    });
  });

  it('refuses a stopped device without its state in build_project', async () => {
    const client = await connect(
      deps({
        buildProject: {
          buildProject: async () =>
            ({
              state: 'finished',
              mode: 'full',
              elapsedSeconds: 3,
              outputsBuilt: false,
              notBuilt: [],
              stoppedAt: [{ id: 2, name: 'River' }],
              session: READY,
            }) as unknown as Awaited<ReturnType<McpDependencies['buildProject']['buildProject']>>,
        },
      }),
    );
    const result = await client.callTool({ name: 'build_project', arguments: { mode: 'full' } });
    expect(result.isError).toBe(true);
  });

  it('admits lastFullBuild in get_build_status (build-status-check design section 5)', async () => {
    const lastFullBuild = {
      startedAt: '2026-10-13T09:30:00.000Z',
      outputsBuilt: false,
      notBuilt: [{ id: 3, name: 'Height Output' }],
      stoppedAt: [{ id: 2, name: 'River', type: 'River', enabled: true, bypassed: false }],
      hint: NOT_BUILT_HINT,
    };
    const client = await connect(
      deps({
        getBuildStatus: {
          getBuildStatus: async () => ({ build: null, previewRunning: false, lastFullBuild, session: READY }),
        },
      }),
    );
    const result = await client.callTool({ name: 'get_build_status', arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ lastFullBuild });
  });

  it('admits a lastFullBuild that holds outputsCheckError in get_build_status (design section 3)', async () => {
    const lastFullBuild = {
      startedAt: '2026-10-13T09:30:00.000Z',
      outputsCheckError: 'The project changed after the build ended; run build_project again.',
    };
    const client = await connect(
      deps({
        getBuildStatus: {
          getBuildStatus: async () => ({ build: null, previewRunning: false, lastFullBuild, session: READY }),
        },
      }),
    );
    const result = await client.callTool({ name: 'get_build_status', arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ lastFullBuild });
  });

  it('refuses a lastFullBuild without startedAt in get_build_status', async () => {
    const client = await connect(
      deps({
        getBuildStatus: {
          getBuildStatus: async () =>
            ({
              build: null,
              previewRunning: false,
              lastFullBuild: { outputsBuilt: true, notBuilt: [], stoppedAt: [] },
              session: READY,
            }) as unknown as Awaited<ReturnType<McpDependencies['getBuildStatus']['getBuildStatus']>>,
        },
      }),
    );
    const result = await client.callTool({ name: 'get_build_status', arguments: {} });
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

  it.each([
    'After a full build that finished within the wait, the result reports whether every output was built (outputsBuilt)',
    'the devices where building stopped on the way to an output that was not built (stoppedAt',
    'a full build ended by stop_build is checked too and its outputs report not built',
    'outputsCheckError',
    'preview, tiled, and group builds, and a running result, are not checked',
  ])('describes the output check in build_project: %s', async (text) => {
    const { tools } = await (await connect(deps())).listTools();
    expect(tools.find((tool) => tool.name === 'build_project')?.description ?? '').toContain(text);
  });

  it('no longer says in build_project that World Machine does not report failed builds', async () => {
    const { tools } = await (await connect(deps())).listTools();
    expect(tools.find((tool) => tool.name === 'build_project')?.description ?? '').not.toContain(
      'World Machine does not report failed builds',
    );
  });

  it.each([
    'After a full build that build_project started has ended, also reports whether every output was built and where building stopped (lastFullBuild).',
    "The first call after a build that outlived build_project's wait runs that check; later calls repeat it.",
    'If this server changed the project after the build ended, the check is skipped.',
    'Edits made in the World Machine window are not seen.',
  ])('describes the last full build in get_build_status: %s', async (text) => {
    const { tools } = await (await connect(deps())).listTools();
    expect(tools.find((tool) => tool.name === 'get_build_status')?.description ?? '').toContain(text);
  });

  it('says in build_project that get_build_status reports the check once the build ends (build-status-check section 5)', async () => {
    const { tools } = await (await connect(deps())).listTools();
    expect(tools.find((tool) => tool.name === 'build_project')?.description ?? '').toContain(
      'check get_build_status, or call stop_build; get_build_status reports the check once the build ends.',
    );
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
