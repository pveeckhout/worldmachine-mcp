import { describe, expect, it } from 'vitest';
import type { DeviceDetail, DeviceSummary, PortLink } from '../../src/domain/device.js';
import {
  type GraphState,
  listedType,
  matchDevices,
  planGraph,
  referencedDeviceIds,
} from '../../src/domain/graph-plan.js';
import { type RawGraphDevice, validateGraphSpec } from '../../src/domain/graph-spec.js';

const row = (id: number, name: string, enabled = true): DeviceSummary => ({ id, name, enabled });
const output = (targets: PortLink[] = []) => ({ port: 1, name: 'Primary Output', targets });

function detail(id: number, name: string, type: string, extra: Partial<DeviceDetail> = {}): DeviceDetail {
  return {
    id,
    name,
    type,
    enabled: true,
    bypassed: false,
    parameters: [],
    inputs: [],
    outputs: [output()],
    ...extra,
  };
}

/** The listed rows are the details' rows, then `extra`. */
function state(
  details: DeviceDetail[],
  extra: DeviceSummary[] = [],
  projectPath: string | null = null,
): GraphState {
  return { projectPath, devices: [...details.map((d) => row(d.id, d.name, d.enabled)), ...extra], details };
}

const spec = (devices: RawGraphDevice[], remove?: string[]) =>
  validateGraphSpec({ version: 1, devices, ...(remove === undefined ? {} : { remove }) });

const OLD = detail(12, 'Old', 'Perlin Noise', { outputs: [output([{ device: 'Eroded', port: 1 }])] });
const ERODED = detail(20, 'Eroded', 'Erosion', {
  parameters: [
    { name: 'steps', type: 'int', value: '4' },
    { name: 'scale', type: 'float', value: '8 km' },
    { name: 'maskSoil', type: 'bool', value: 'true' },
    { name: 'soilMask', type: 'enum', value: 'Presence Mask' },
    { name: 'groupBasic', type: 'other', value: '' },
    { name: 'writeButton', type: 'action', value: '' },
  ],
  inputs: [
    { port: 1, name: 'Primary Input', source: { device: 'Old', port: 1 } },
    { port: 2, name: 'Water input' },
  ],
});
const PROJECT = state([OLD, ERODED]);

describe('planGraph (spec v3 section 5)', () => {
  it('adds a missing device with its enabled state, parameters, and inputs from a device the plan adds', () => {
    const plan = planGraph(
      spec([
        { name: 'Shape', type: 'Layout Generator' },
        {
          name: 'Base',
          type: 'Advanced Perlin',
          enabled: false,
          parameters: { octaves: 8, scale: 0.4 },
          inputs: { '1': 'Shape.1', '2': null },
        },
      ]),
      state([]),
    );
    expect(plan).toEqual({
      conflicts: [],
      steps: [
        { op: 'add', device: 'Shape', type: 'Layout Generator' },
        { op: 'add', device: 'Base', type: 'Advanced Perlin' },
        { op: 'set-enabled', device: 'Base', to: false },
        { op: 'set-parameter', device: 'Base', name: 'octaves', to: '8', comparable: false },
        { op: 'set-parameter', device: 'Base', name: 'scale', to: '0.4', comparable: false },
        { op: 'connect', device: 'Base', port: 1, from: 'Shape.1', source: { device: 'Shape', port: 1 } },
      ],
      unchanged: [],
    });
  });

  it('orders steps: disconnect, remove, add, set-enabled, set-parameter, connect', () => {
    const plan = planGraph(
      spec(
        [
          {
            name: 'Eroded',
            type: 'Erosion',
            enabled: false,
            parameters: { steps: 6 },
            inputs: { '1': 'Base' },
          },
          { name: 'Base', type: 'Gradient' },
        ],
        ['Old'],
      ),
      PROJECT,
    );
    expect(plan.conflicts).toEqual([]);
    expect(plan.steps).toEqual([
      {
        op: 'disconnect',
        device: 'Eroded',
        id: 20,
        port: 1,
        from: 'Old.1',
        source: { device: 'Old', id: 12, port: 1 },
      },
      { op: 'remove', device: 'Old', id: 12, wiresRemoved: [] },
      { op: 'add', device: 'Base', type: 'Gradient' },
      { op: 'set-enabled', device: 'Eroded', id: 20, from: true, to: false },
      { op: 'set-parameter', device: 'Eroded', id: 20, name: 'steps', from: '4', to: '6', comparable: true },
      {
        op: 'connect',
        device: 'Eroded',
        id: 20,
        port: 1,
        from: 'Base.1',
        source: { device: 'Base', port: 1 },
      },
    ]);
  });

  it('matches names regardless of case and plans no rename (Review Focus 3, D11)', () => {
    const plan = planGraph(spec([{ name: 'ERODED', type: 'Erosion', parameters: { steps: 4 } }]), PROJECT);
    expect(plan).toEqual({ conflicts: [], steps: [], unchanged: ['ERODED'] });
  });

  it('compares types through the names device info reports (spec fact 79)', () => {
    const shapes = detail(7, 'Shape', 'Shapes');
    const output = detail(8, 'Out', 'Height Output');
    expect(
      planGraph(
        spec([
          { name: 'Shape', type: 'Layout Generator' },
          { name: 'Out', type: 'File Output' },
        ]),
        state([shapes, output]),
      ),
    ).toEqual({ conflicts: [], steps: [], unchanged: ['Shape', 'Out'] });
    expect(planGraph(spec([{ name: 'Shape', type: 'Shapes' }]), state([shapes])).conflicts).toEqual([]);
    expect(listedType('Gradient')).toBe('Gradient');
  });

  it('matches a 23-character name', () => {
    const long = detail(5, 'Twenty-three characters', 'Gradient');
    expect(planGraph(spec([{ name: 'Twenty-three characters', type: 'Gradient' }]), state([long]))).toEqual({
      conflicts: [],
      steps: [],
      unchanged: ['Twenty-three characters'],
    });
  });

  it.each<[string, GraphState, ReturnType<typeof spec>, string, string]>([
    [
      'a managed name two devices have',
      state([], [row(1, 'Noise'), row(2, 'noise')]),
      spec([{ name: 'Noise', type: 'Perlin Noise' }]),
      'Noise',
      '#1, #2',
    ],
    [
      'a remove name two devices have',
      state([], [row(1, 'Noise'), row(2, 'Noise')]),
      spec([], ['Noise']),
      'Noise',
      'use #<id>',
    ],
    [
      'another type',
      PROJECT,
      spec([{ name: 'Eroded', type: 'Thermal Erosion' }]),
      'Eroded',
      "type 'Erosion', not 'Thermal Erosion'",
    ],
    [
      'a source no device has',
      state([]),
      spec([{ name: 'Base', type: 'Gradient', inputs: { '1': 'Ghost' } }]),
      'Base',
      'matches no device',
    ],
    [
      'a source two devices have',
      state([], [row(1, 'Noise'), row(2, 'Noise')]),
      spec([{ name: 'Base', type: 'Gradient', inputs: { '1': 'Noise' } }]),
      'Base',
      'use #<id>',
    ],
    [
      'a source in remove',
      PROJECT,
      spec([{ name: 'Eroded', type: 'Erosion', inputs: { '1': 'Old' } }], ['Old']),
      'Eroded',
      'is in remove',
    ],
    [
      'an input port the device lacks',
      PROJECT,
      spec([{ name: 'Eroded', type: 'Erosion', inputs: { '3': null } }]),
      'Eroded',
      'no input port 3',
    ],
    [
      'an output port the source lacks',
      PROJECT,
      spec([{ name: 'Eroded', type: 'Erosion', inputs: { '2': 'Old.2' } }]),
      'Eroded',
      "#12 'Old' has no output port 2",
    ],
    [
      'a parameter name in another case',
      PROJECT,
      spec([{ name: 'Eroded', type: 'Erosion', parameters: { Steps: 6 } }]),
      'Eroded',
      "no parameter 'Steps'",
    ],
    [
      'an other parameter',
      PROJECT,
      spec([{ name: 'Eroded', type: 'Erosion', parameters: { groupBasic: 1 } }]),
      'Eroded',
      '(other)',
    ],
    [
      'an action parameter',
      PROJECT,
      spec([{ name: 'Eroded', type: 'Erosion', parameters: { writeButton: true } }]),
      'Eroded',
      '(action)',
    ],
    [
      'a decimal for an int (D2)',
      PROJECT,
      spec([{ name: 'Eroded', type: 'Erosion', parameters: { steps: 6.5 } }]),
      'Eroded',
      '(int)',
    ],
    [
      'an enum label (D1, D2)',
      PROJECT,
      spec([{ name: 'Eroded', type: 'Erosion', parameters: { soilMask: 'Presence Mask' } }]),
      'Eroded',
      '(enum)',
    ],
    [
      'a current source name two devices share (Review Focus 5, D4)',
      state([ERODED], [row(12, 'Old'), row(13, 'Old')]),
      spec([{ name: 'Eroded', type: 'Erosion', inputs: { '1': null } }]),
      'Eroded',
      '#12, #13 share',
    ],
    [
      'a managed device removed by #<id>',
      PROJECT,
      spec([{ name: 'Eroded', type: 'Erosion' }], ['#20']),
      'Eroded',
      'also in remove',
    ],
  ])('reports a conflict for %s', (_label, project, graph, entry, fragment) => {
    expect(planGraph(graph, project).conflicts).toEqual([
      { entry, reason: expect.stringContaining(fragment) },
    ]);
  });

  it.each<[string, Record<string, string | number | boolean>, object[]]>([
    ['an equal int', { steps: 4 }, []],
    ['an equal int given as text', { steps: '4' }, []],
    ['another int', { steps: 5 }, [{ name: 'steps', from: '4', to: '5', comparable: true }]],
    ['an equal bool word', { maskSoil: 'yes' }, []],
    [
      'another bool',
      { maskSoil: false },
      [{ name: 'maskSoil', from: 'true', to: 'false', comparable: true }],
    ],
    ['a float', { scale: 0.5 }, [{ name: 'scale', from: '8 km', to: '0.5', comparable: false }]],
    [
      'an enum index (D1)',
      { soilMask: 0 },
      [{ name: 'soilMask', from: 'Presence Mask', to: '0', comparable: false }],
    ],
  ])('compares %s', (_label, parameters, expected) => {
    const plan = planGraph(spec([{ name: 'Eroded', type: 'Erosion', parameters }]), PROJECT);
    expect(plan.steps).toEqual(
      expected.map((fields) => ({ op: 'set-parameter', device: 'Eroded', id: 20, ...fields })),
    );
  });

  it('disconnects a wired input set to null and leaves an unwired one alone', () => {
    const plan = planGraph(
      spec([{ name: 'Eroded', type: 'Erosion', inputs: { '1': null, '2': null } }]),
      PROJECT,
    );
    expect(plan.steps).toEqual([
      {
        op: 'disconnect',
        device: 'Eroded',
        id: 20,
        port: 1,
        from: 'Old.1',
        source: { device: 'Old', id: 12, port: 1 },
      },
    ]);
  });

  it('plans nothing for an input already wired from the spec source, by name or #<id> (Review Focus 4)', () => {
    for (const source of ['Old', 'old.1', '#12.1']) {
      const plan = planGraph(spec([{ name: 'Eroded', type: 'Erosion', inputs: { '1': source } }]), PROJECT);
      expect(plan).toEqual({ conflicts: [], steps: [], unchanged: ['Eroded'] });
    }
  });

  it('removes a device with the wires it takes, and lists an absent entry as unchanged (D12, D13)', () => {
    expect(planGraph(spec([], ['Old', 'Gone']), PROJECT)).toEqual({
      conflicts: [],
      steps: [{ op: 'remove', device: 'Old', id: 12, wiresRemoved: ['Old.1 -> Eroded.1'] }],
      unchanged: ['Gone (already absent)'],
    });
  });

  it('plans only comparable: false steps after a simulated apply', () => {
    const graph = spec([
      {
        name: 'Eroded',
        type: 'Erosion',
        parameters: { steps: 6, scale: 0.5, maskSoil: false, soilMask: 1 },
        inputs: { '1': 'Base' },
      },
      { name: 'Base', type: 'Gradient' },
    ]);
    expect(planGraph(graph, PROJECT).steps.length).toBeGreaterThan(0);
    const base = detail(30, 'Base', 'Gradient', { outputs: [output([{ device: 'Eroded', port: 1 }])] });
    const eroded: DeviceDetail = {
      ...ERODED,
      parameters: ERODED.parameters.map((parameter) => {
        const after: Record<string, string> = {
          steps: '6',
          scale: '4 km',
          maskSoil: 'false',
          soilMask: 'Distance Mask',
        };
        return { ...parameter, value: after[parameter.name] ?? parameter.value };
      }),
      inputs: [
        { port: 1, name: 'Primary Input', source: { device: 'Base', port: 1 } },
        { port: 2, name: 'Water input' },
      ],
    };
    const again = planGraph(graph, state([{ ...OLD, outputs: [output()] }, eroded, base]));
    expect(again.conflicts).toEqual([]);
    expect(
      again.steps.map((step) => (step.op === 'set-parameter' ? [step.name, step.comparable] : step.op)),
    ).toEqual([
      ['scale', false],
      ['soilMask', false],
    ]);
    expect(again.unchanged).toEqual(['Base']);
  });
});

describe('matchDevices and referencedDeviceIds', () => {
  it('matches #<id> by id and names regardless of case', () => {
    const rows = [row(1, 'Noise'), row(2, 'NOISE'), row(3, 'Base')];
    expect(matchDevices(rows, '#3')).toEqual([row(3, 'Base')]);
    expect(matchDevices(rows, 'noise').map((device) => device.id)).toEqual([1, 2]);
    expect(matchDevices(rows, '#9')).toEqual([]);
  });

  it('lists managed, removed, and source devices once, in that order, skipping ambiguous names', () => {
    const rows = [row(1, 'Noise'), row(2, 'Noise'), row(3, 'Base'), row(4, 'Old'), row(5, 'Shape')];
    const graph = spec(
      [
        { name: 'Base', type: 'Gradient', inputs: { '1': 'Shape', '2': 'Noise', '3': '#3' } },
        { name: 'New', type: 'Gradient', inputs: { '1': 'Base' } },
      ],
      ['Old', 'Noise'],
    );
    expect(referencedDeviceIds(graph, rows)).toEqual([3, 4, 5]);
  });
});
