import { describe, expect, it } from 'vitest';
import type { DeviceDetail, DeviceSummary, InputPort, PortLink } from '../../src/domain/device.js';
import {
  canonicalJson,
  type GraphState,
  listedType,
  matchDevices,
  planGraph,
  planId,
  predictedSourceIds,
  referencedDeviceIds,
  sharedSourceIds,
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
    portTypes: 'unknown',
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

  it('orders steps: disconnect, remove, add, set-enabled, set-bypassed, set-parameter, connect', () => {
    const plan = planGraph(
      spec(
        [
          {
            name: 'Eroded',
            type: 'Erosion',
            enabled: false,
            bypassed: true,
            parameters: { steps: 6 },
            inputs: { '1': 'Base' },
          },
          { name: 'Base', type: 'Gradient', bypassed: true },
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
      { op: 'set-bypassed', device: 'Eroded', id: 20, from: false, to: true },
      { op: 'set-bypassed', device: 'Base', to: true },
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

  it('plans set-bypassed for an existing device whose bypass differs, with id, from, and to', () => {
    const plan = planGraph(spec([{ name: 'Eroded', type: 'Erosion', bypassed: true }]), PROJECT);
    expect(plan).toEqual({
      conflicts: [],
      steps: [{ op: 'set-bypassed', device: 'Eroded', id: 20, from: false, to: true }],
      unchanged: [],
    });
  });

  it('plans nothing for an equal or omitted bypassed, and lists the device as unchanged', () => {
    const equal = planGraph(spec([{ name: 'Eroded', type: 'Erosion', bypassed: false }]), PROJECT);
    expect(equal).toEqual({ conflicts: [], steps: [], unchanged: ['Eroded'] });
    const omitted = planGraph(spec([{ name: 'Eroded', type: 'Erosion' }]), PROJECT);
    expect(omitted).toEqual({ conflicts: [], steps: [], unchanged: ['Eroded'] });
  });

  it('leaves an entry that a parameter or input-port conflict names out of unchanged', () => {
    expect(planGraph(spec([{ name: 'Eroded', type: 'Erosion', parameters: { nope: 1 } }]), PROJECT)).toEqual({
      conflicts: [{ entry: 'Eroded', reason: "#20 has no parameter 'nope'" }],
      steps: [],
      unchanged: [],
    });
    expect(planGraph(spec([{ name: 'Eroded', type: 'Erosion', inputs: { '9': null } }]), PROJECT)).toEqual({
      conflicts: [{ entry: 'Eroded', reason: '#20 has no input port 9' }],
      steps: [],
      unchanged: [],
    });
  });

  it('plans set-bypassed for an added device only when bypassed is true, after set-enabled and before parameters', () => {
    const plan = planGraph(
      spec([
        { name: 'On', type: 'Gradient', bypassed: true, enabled: false, parameters: { Width: 1 } },
        { name: 'Off', type: 'Gradient', bypassed: false },
      ]),
      state([]),
    );
    expect(plan.steps).toEqual([
      { op: 'add', device: 'On', type: 'Gradient' },
      { op: 'add', device: 'Off', type: 'Gradient' },
      { op: 'set-enabled', device: 'On', to: false },
      { op: 'set-bypassed', device: 'On', to: true },
      { op: 'set-parameter', device: 'On', name: 'Width', to: '1', comparable: false },
    ]);
  });

  it('plans no set-bypassed once the project holds the bypass the spec gives', () => {
    const bypassed = detail(20, 'Eroded', 'Erosion', { ...ERODED, bypassed: true });
    const plan = planGraph(
      spec([{ name: 'Eroded', type: 'Erosion', bypassed: true }]),
      state([OLD, bypassed]),
    );
    expect(plan).toEqual({ conflicts: [], steps: [], unchanged: ['Eroded'] });
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
      'a current source name two devices share, neither listing the input (revision 6)',
      state([ERODED, detail(12, 'Old', 'Perlin Noise'), detail(13, 'Old', 'Perlin Noise')]),
      spec([{ name: 'Eroded', type: 'Erosion', inputs: { '1': null } }]),
      'Eroded',
      "a name #12, #13 share, and none of them lists 'Eroded' input 1 among its output targets",
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

  it('leaves a managed device out of unchanged when a remove takes its wire, at either end', () => {
    expect(planGraph(spec([{ name: 'Eroded', type: 'Erosion' }], ['Old']), PROJECT)).toEqual({
      conflicts: [],
      steps: [{ op: 'remove', device: 'Old', id: 12, wiresRemoved: ['Old.1 -> Eroded.1'] }],
      unchanged: [],
    });
    expect(planGraph(spec([{ name: 'Old', type: 'Perlin Noise' }], ['Eroded']), PROJECT)).toEqual({
      conflicts: [],
      steps: [{ op: 'remove', device: 'Eroded', id: 20, wiresRemoved: ['Old.1 -> Eroded.1'] }],
      unchanged: [],
    });
  });

  it('marks no managed device for a wire of a removed device that it cannot identify', () => {
    const feeding = output([{ device: 'X', port: 1 }]);
    const project = state([
      detail(3, 'Combiner', 'Combiner', { outputs: [feeding] }),
      detail(4, 'Combiner', 'Combiner', { outputs: [feeding] }),
      detail(9, 'X', 'Erosion', {
        inputs: [{ port: 1, name: 'Primary Input', source: { device: 'Combiner', port: 1 } }],
      }),
    ]);
    const plan = planGraph(spec([{ name: 'c3', id: 3, type: 'Combiner' }], ['X']), project);
    expect(plan.steps).toEqual([{ op: 'remove', device: 'X', id: 9, wiresRemoved: ['Combiner.1 -> X.1'] }]);
    expect(plan.unchanged).toEqual(['c3']);
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

describe('planGraph with ids and the Combiner rule (spec v3 revision 6)', () => {
  it('manages a device by id under a label that differs from its listed name, without add or rename', () => {
    const plan = planGraph(
      spec([{ name: 'Renamed', id: 20, type: 'Erosion', parameters: { steps: 6 } }]),
      PROJECT,
    );
    expect(plan).toEqual({
      conflicts: [],
      steps: [
        {
          op: 'set-parameter',
          device: 'Renamed',
          id: 20,
          name: 'steps',
          from: '4',
          to: '6',
          comparable: true,
        },
      ],
      unchanged: [],
    });
  });

  it.each<[string, ReturnType<typeof spec>, string, string]>([
    [
      'an id no listed device has',
      spec([{ name: 'X', id: 99, type: 'Gradient' }]),
      'X',
      '#99 matches no listed device; an entry with id never adds a device',
    ],
    [
      'an id of another type',
      spec([{ name: 'X', id: 12, type: 'Gradient' }]),
      'X',
      "#12 has type 'Perlin Noise', not 'Gradient'",
    ],
    [
      'an id whose device a remove name names',
      spec([{ name: 'X', id: 12, type: 'Perlin Noise' }], ['Old']),
      'X',
      '#12 is managed and also in remove',
    ],
    [
      'a device matched by two entries (Review Focus 2, ruling 1)',
      spec([
        { name: 'Old', type: 'Perlin Noise' },
        { name: 'X', id: 12, type: 'Perlin Noise' },
      ]),
      'X',
      "#12 is also managed by 'Old'",
    ],
  ])('reports %s', (_label, graph, entry, reason) => {
    expect(planGraph(graph, PROJECT).conflicts).toEqual([{ entry, reason }]);
  });

  it('reports a device matched by two entries when the earlier one has the wrong type (Codex round 1, ruling 3)', () => {
    expect(
      planGraph(
        spec([
          { name: 'Old', type: 'Gradient' },
          { name: 'X', id: 12, type: 'Perlin Noise' },
        ]),
        PROJECT,
      ).conflicts,
    ).toEqual([
      { entry: 'Old', reason: "#12 has type 'Perlin Noise', not 'Gradient'" },
      { entry: 'X', reason: "#12 is also managed by 'Old'" },
    ]);
  });

  it('plans no add for an entry with an id no device has', () => {
    expect(planGraph(spec([{ name: 'X', id: 99, type: 'Gradient' }]), PROJECT).steps).toEqual([]);
  });

  it('resolves a label as an input source before any listed name, and shows labels in steps', () => {
    const plan = planGraph(
      spec([
        { name: 'src', id: 12, type: 'Perlin Noise' },
        { name: 'Eroded', type: 'Erosion', inputs: { '1': 'src', '2': '#12' } },
      ]),
      PROJECT,
    );
    expect(plan).toEqual({
      conflicts: [],
      steps: [
        {
          op: 'connect',
          device: 'Eroded',
          id: 20,
          port: 2,
          from: 'src.1',
          source: { device: 'src', id: 12, port: 1 },
        },
      ],
      unchanged: ['src'],
    });
  });

  it('lists an id-bound entry as unchanged when a removed device has its label (Review Focus 1)', () => {
    const plan = planGraph(
      spec([{ name: 'Combiner', id: 5, type: 'Combiner' }], ['#6']),
      state([detail(5, 'Combiner', 'Combiner'), detail(6, 'Combiner', 'Combiner')]),
    );
    expect(plan).toEqual({
      conflicts: [],
      steps: [{ op: 'remove', device: 'Combiner', id: 6, wiresRemoved: [] }],
      unchanged: ['Combiner'],
    });
  });

  const ADD_BY_ID = 'add it with add_device and give its id in the spec';
  it.each<[string, string, string]>([
    [
      'Combiner',
      'Mix',
      `World Machine ignores a rename of a Combiner, so it cannot be added as 'Mix'; ${ADD_BY_ID}`,
    ],
    [
      'Combiner',
      'combiner',
      `World Machine ignores a rename of a Combiner, so it cannot be added as 'combiner'; ${ADD_BY_ID}`,
    ],
    [
      'Average',
      'Mix',
      `World Machine ignores a rename of a Combiner, so it cannot be added as 'Mix'; ${ADD_BY_ID}, and give the type as 'Combiner': 'Average' is an alias, which fails the type check (fact 81)`,
    ],
  ])(
    'refuses a %s entry named %s without id that matches no device (facts 80-81, rulings 2-3)',
    (type, name, reason) => {
      expect(planGraph(spec([{ name, type }]), state([]))).toEqual({
        conflicts: [{ entry: name, reason }],
        steps: [],
        unchanged: [],
      });
    },
  );

  it('adds a Combiner named exactly Combiner, and plans as before for a name a device has', () => {
    expect(planGraph(spec([{ name: 'Combiner', type: 'Combiner' }]), state([])).steps).toEqual([
      { op: 'add', device: 'Combiner', type: 'Combiner' },
    ]);
    expect(
      planGraph(spec([{ name: 'Mix', type: 'Combiner' }]), state([detail(5, 'Mix', 'Gradient')])).conflicts,
    ).toEqual([{ entry: 'Mix', reason: "#5 has type 'Gradient', not 'Combiner'" }]);
  });

  it('manages an existing Combiner from an entry named combiner, matched regardless of case (ruling 2)', () => {
    expect(
      planGraph(spec([{ name: 'combiner', type: 'Combiner' }]), state([detail(5, 'Combiner', 'Combiner')])),
    ).toEqual({
      conflicts: [],
      steps: [],
      unchanged: ['combiner'],
    });
  });

  it('applies the rule to every Combiner alias and to no other type, a prototype key included (facts 80-81)', () => {
    // The Combiner itself is the 'Combiner' row of the table above.
    expect(planGraph(spec([{ name: 'Mix', type: 'Subtract' }]), state([])).conflicts).toEqual([
      {
        entry: 'Mix',
        reason: `World Machine ignores a rename of a Combiner, so it cannot be added as 'Mix'; ${ADD_BY_ID}, and give the type as 'Combiner': 'Subtract' is an alias, which fails the type check (fact 81)`,
      },
    ]);
    for (const type of ['Gradient', 'constructor']) {
      expect(planGraph(spec([{ name: 'Mix', type }]), state([]))).toEqual({
        conflicts: [],
        steps: [{ op: 'add', device: 'Mix', type }],
        unchanged: [],
      });
    }
  });

  const fed = (port: number, device?: string): InputPort =>
    device === undefined
      ? { port, name: 'Primary Input' }
      : { port, name: 'Primary Input', source: { device, port: 1 } };
  // Spec section 5's layered graph, as wire list shows it after an apply: base and hills into #3, #3 and the mountains
  // into #6, #6 into Erosion. Both Combiners keep the name 'Combiner' (fact 80).
  const BASE = detail(1, 'Base', 'Advanced Perlin', { outputs: [output([{ device: 'Combiner', port: 1 }])] });
  const HILLS = detail(2, 'Hills', 'Advanced Perlin', {
    outputs: [output([{ device: 'Combiner', port: 2 }])],
  });
  const HILLS_MIX = detail(3, 'Combiner', 'Combiner', {
    inputs: [fed(1, 'Base'), fed(2, 'Hills')],
    outputs: [output([{ device: 'Combiner', port: 1 }])],
  });
  const MOUNTAINS = detail(4, 'Mountains', 'Advanced Perlin', {
    outputs: [output([{ device: 'Combiner', port: 2 }])],
  });
  const MOUNTAIN_MIX = detail(6, 'Combiner', 'Combiner', {
    inputs: [fed(1, 'Combiner'), fed(2, 'Mountains')],
    outputs: [output([{ device: 'Erosion', port: 1 }])],
  });
  const EROSION = detail(7, 'Erosion', 'Erosion', { inputs: [fed(1, 'Combiner')] });
  const LAYERED = state([BASE, HILLS, HILLS_MIX, MOUNTAINS, MOUNTAIN_MIX, EROSION]);
  const layered = (erosionFrom: string) =>
    spec([
      { name: 'Base', type: 'Advanced Perlin' },
      { name: 'Hills', type: 'Advanced Perlin' },
      { name: 'Mountains', type: 'Advanced Perlin' },
      { name: 'hills mix', id: 3, type: 'Combiner', inputs: { '1': 'Base', '2': 'Hills' } },
      { name: 'mountain mix', id: 6, type: 'Combiner', inputs: { '1': 'hills mix', '2': 'Mountains' } },
      { name: 'Erosion', type: 'Erosion', inputs: { '1': erosionFrom } },
    ]);

  it('plans nothing for the layered graph of section 5 once applied', () => {
    expect(planGraph(layered('mountain mix'), LAYERED)).toEqual({
      conflicts: [],
      steps: [],
      unchanged: ['Base', 'Hills', 'Mountains', 'hills mix', 'mountain mix', 'Erosion'],
    });
  });

  it('moves an input from one Combiner to the other, by label and id', () => {
    expect(planGraph(layered('hills mix'), LAYERED).steps).toEqual([
      {
        op: 'disconnect',
        device: 'Erosion',
        id: 7,
        port: 1,
        from: 'mountain mix.1',
        source: { device: 'mountain mix', id: 6, port: 1 },
      },
      {
        op: 'connect',
        device: 'Erosion',
        id: 7,
        port: 1,
        from: 'hills mix.1',
        source: { device: 'hills mix', id: 3, port: 1 },
      },
    ]);
  });

  it('reports an ambiguous current source with the candidate ids', () => {
    const feeding = output([{ device: 'Combiner', port: 1 }]);
    const project = state([
      detail(3, 'Combiner', 'Combiner', { outputs: [feeding] }),
      detail(4, 'Combiner', 'Combiner', { outputs: [feeding] }),
      detail(5, 'Combiner', 'Combiner', { inputs: [fed(1, 'Combiner'), fed(2)] }),
      detail(6, 'Combiner', 'Combiner', { inputs: [fed(1, 'Combiner'), fed(2)] }),
    ]);
    expect(planGraph(spec([{ name: 'p', id: 5, type: 'Combiner', inputs: { '1': null } }]), project)).toEqual(
      {
        conflicts: [
          {
            entry: 'p',
            reason:
              "input 1 is wired from 'Combiner', a name #3, #4, #5, #6 share, and #3, #4 each list 'Combiner' input 1 among their output targets; wire list names devices, so the wire's source cannot be identified",
          },
        ],
        steps: [],
        // An entry whose only problem is an unidentified current source plans no step for it, and a conflict names it,
        // so it is not unchanged either.
        unchanged: [],
      },
    );
  });

  const RAMP_TO_BOTH = detail(10, 'Ramp', 'Gradient', {
    outputs: [
      output([
        { device: 'Combiner', port: 1 },
        { device: 'Combiner', port: 1 },
      ]),
    ],
  });
  const FIRST = detail(536, 'Combiner', 'Combiner', { inputs: [fed(1, 'Ramp'), fed(2)] });
  const SECOND = detail(537, 'Combiner', 'Combiner', { inputs: [fed(1, 'Ramp'), fed(2)] });

  it('lists both wires of a removed device to two devices that share a name (D12)', () => {
    const plan = planGraph(
      spec(
        [
          { name: 'first mix', id: 536, type: 'Combiner' },
          { name: 'second mix', id: 537, type: 'Combiner' },
        ],
        ['Ramp'],
      ),
      state([RAMP_TO_BOTH, FIRST, SECOND]),
    );
    expect(plan.steps).toEqual([
      {
        op: 'remove',
        device: 'Ramp',
        id: 10,
        wiresRemoved: ['Ramp.1 -> Combiner.1', 'Ramp.1 -> Combiner.1'],
      },
    ]);
  });

  it('keeps the uncut one of two wires to same-named devices (Review Focus 4)', () => {
    const plan = planGraph(
      spec(
        [
          { name: 'first mix', id: 536, type: 'Combiner' },
          { name: 'second mix', id: 537, type: 'Combiner', inputs: { '1': null } },
        ],
        ['Ramp'],
      ),
      state([RAMP_TO_BOTH, FIRST, SECOND]),
    );
    expect(plan.steps).toEqual([
      {
        op: 'disconnect',
        device: 'second mix',
        id: 537,
        port: 1,
        from: 'Ramp.1',
        source: { device: 'Ramp', id: 10, port: 1 },
      },
      { op: 'remove', device: 'Ramp', id: 10, wiresRemoved: ['Ramp.1 -> Combiner.1'] },
    ]);
  });

  // User ruling 6: a removed device's own input, wired from a name several devices share, is shown by its text and is
  // never a conflict, whether the output targets name one source, several, or none (graph-plan.ts:538-540).
  it.each([
    ['both list the removed device as a target (ambiguous)', true],
    ['neither lists the removed device as a target (unknown)', false],
  ])(
    "shows a removed device's unresolved input as text, with no conflict: %s (user ruling 6)",
    (_title, listed) => {
      const targets = listed ? [output([{ device: 'Old', port: 1 }])] : [output()];
      const old = detail(12, 'Old', 'Gradient', { inputs: [fed(1, 'Combiner')] });
      const plan = planGraph(
        spec([], ['Old']),
        state([
          old,
          detail(536, 'Combiner', 'Combiner', { outputs: targets }),
          detail(537, 'Combiner', 'Combiner', { outputs: targets }),
        ]),
      );
      expect(plan.conflicts).toEqual([]);
      expect(plan.steps).toEqual([
        { op: 'remove', device: 'Old', id: 12, wiresRemoved: ['Combiner.1 -> Old.1'] },
      ]);
    },
  );

  // Codex round 1, ruling 1. #537 is a second 'Combiner' that Ramp does not feed, so each line needs the resolver.
  const UNFED = detail(537, 'Combiner', 'Combiner', { inputs: [fed(1), fed(2)] });

  it('keeps a repeated target line as one wire when two devices share the target name (Codex round 1, ruling 1)', () => {
    // Trace: line 1 'Combiner' [1]: named #536, #537 (not branch A); #536 input 1 resolves to Ramp.1 (one listed
    // 'Ramp'), #537 input 1 has no wire, so qualifying is [536]; '536.1' is free: branch B, key '10.1>536.1', taken
    // {'536.1'}. Line 2, the same text: qualifying [536], '536.1' taken: branch C, #536, the same key, dropped by keep().
    const ramp = detail(10, 'Ramp', 'Gradient', {
      outputs: [
        output([
          { device: 'Combiner', port: 1 },
          { device: 'Combiner', port: 1 },
        ]),
      ],
    });
    expect(
      planGraph(
        spec(
          [
            { name: 'first mix', id: 536, type: 'Combiner' },
            { name: 'second mix', id: 537, type: 'Combiner' },
          ],
          ['Ramp'],
        ),
        state([ramp, FIRST, UNFED]),
      ).steps,
    ).toEqual([{ op: 'remove', device: 'Ramp', id: 10, wiresRemoved: ['Ramp.1 -> Combiner.1'] }]);
  });

  it('keeps a wire to an unread same-named device when a read sibling has its wire cut (review round 1)', () => {
    // #536 is read, #537 is only listed. Line 1 maps to #536 (cut). Line 2 would repeat it, but #537 may be its target,
    // so it is keyed by its text and stays.
    const ramp = detail(10, 'Ramp', 'Gradient', {
      outputs: [
        output([
          { device: 'Combiner', port: 1 },
          { device: 'Combiner', port: 1 },
        ]),
      ],
    });
    expect(
      planGraph(
        spec([{ name: 'first mix', id: 536, type: 'Combiner', inputs: { '1': null } }], ['Ramp']),
        state([ramp, FIRST], [row(537, 'Combiner')]),
      ).steps,
    ).toEqual([
      {
        op: 'disconnect',
        device: 'first mix',
        id: 536,
        port: 1,
        from: 'Ramp.1',
        source: { device: 'Ramp', id: 10, port: 1 },
      },
      { op: 'remove', device: 'Ramp', id: 10, wiresRemoved: ['Ramp.1 -> Combiner.1'] },
    ]);
  });

  it('drops the cut one of two wires to two inputs of one device (Codex round 1, ruling 1)', () => {
    // Trace: the disconnect of 'first mix' input 2 cuts '10.1>536.2'. Line 1 'Combiner' [1]: qualifying [536] (#537
    // input 1 has no wire), '536.1' free: branch B, key '10.1>536.1', kept. Line 2 'Combiner' [2]: #536 input 2
    // resolves to Ramp.1, #537 input 2 has no wire, so qualifying [536]; '536.2' is free (taken holds '536.1' only):
    // branch B, key '10.1>536.2', which is cut, so it is dropped. Keyed by id alone, #536 would count as taken and the
    // line would fall back to its text and stay.
    const ramp = detail(10, 'Ramp', 'Gradient', {
      outputs: [
        output([
          { device: 'Combiner', port: 1 },
          { device: 'Combiner', port: 2 },
        ]),
      ],
    });
    const both = detail(536, 'Combiner', 'Combiner', { inputs: [fed(1, 'Ramp'), fed(2, 'Ramp')] });
    expect(
      planGraph(
        spec(
          [
            { name: 'first mix', id: 536, type: 'Combiner', inputs: { '2': null } },
            { name: 'second mix', id: 537, type: 'Combiner' },
          ],
          ['Ramp'],
        ),
        state([ramp, both, UNFED]),
      ).steps,
    ).toEqual([
      {
        op: 'disconnect',
        device: 'first mix',
        id: 536,
        port: 2,
        from: 'Ramp.1',
        source: { device: 'Ramp', id: 10, port: 1 },
      },
      { op: 'remove', device: 'Ramp', id: 10, wiresRemoved: ['Ramp.1 -> Combiner.1'] },
    ]);
  });

  it('keeps a target line World Machine repeats as one wire (raw/v5-read-formats.txt l.44-45)', () => {
    const ramp = detail(10, 'Ramp', 'Gradient', {
      outputs: [
        output([
          { device: 'Vegetation', port: 2 },
          { device: 'Vegetation', port: 2 },
        ]),
      ],
    });
    expect(planGraph(spec([], ['Ramp']), state([ramp], [row(11, 'Vegetation')])).steps).toEqual([
      { op: 'remove', device: 'Ramp', id: 10, wiresRemoved: ['Ramp.1 -> Vegetation.2'] },
    ]);
  });
});

describe('planGraph and a wire from a device into its own input (fact 98)', () => {
  const selfWire = (port: number) =>
    `input ${port} is wired from the device itself; World Machine refuses a wire from a device into its own input (fact 98)`;

  it.each<[string, RawGraphDevice]>([
    ['its name', { name: 'Eroded', type: 'Erosion', inputs: { '1': 'Eroded' } }],
    ['its #<id>', { name: 'Eroded', type: 'Erosion', inputs: { '1': '#20' } }],
    [
      'the label of its entry with id',
      { name: 'Renamed', id: 20, type: 'Erosion', inputs: { '1': 'Renamed' } },
    ],
    [
      'its listed name from an entry with id',
      { name: 'Renamed', id: 20, type: 'Erosion', inputs: { '1': 'Eroded' } },
    ],
  ])(
    'refuses an existing device whose input names %s, planning no disconnect or connect',
    (_label, entry) => {
      const plan = planGraph(spec([entry]), PROJECT);
      expect(plan.conflicts).toEqual([{ entry: entry.name, reason: selfWire(1) }]);
      expect(plan.steps).toEqual([]);
    },
  );

  it('refuses an added device whose input names its own entry, planning no connect', () => {
    const plan = planGraph(spec([{ name: 'Base', type: 'Gradient', inputs: { '2': 'base' } }]), state([]));
    expect(plan.conflicts).toEqual([{ entry: 'Base', reason: selfWire(2) }]);
    expect(plan.steps).toEqual([{ op: 'add', device: 'Base', type: 'Gradient' }]);
  });

  it('wires one of two devices that share a name into the other', () => {
    const twin = (id: number) =>
      detail(id, 'Twin', 'Erosion', { inputs: [{ port: 1, name: 'Primary Input' }] });
    const plan = planGraph(
      spec([{ name: 'Second', id: 31, type: 'Erosion', inputs: { '1': '#30' } }]),
      state([twin(30), twin(31)]),
    );
    expect(plan.conflicts).toEqual([]);
    expect(plan.steps).toEqual([
      {
        op: 'connect',
        device: 'Second',
        id: 31,
        port: 1,
        from: 'Twin.1',
        source: { device: 'Twin', id: 30, port: 1 },
      },
    ]);
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

  it('notes an entry with id by #<id>, and an id no device has not at all (revision 6)', () => {
    const rows = [row(4, 'Combiner'), row(5, 'Combiner'), row(6, 'Base')];
    const graph = spec([
      { name: 'hills mix', id: 5, type: 'Combiner', inputs: { '1': 'Base' } },
      { name: 'ghost', id: 9, type: 'Combiner' },
    ]);
    expect(referencedDeviceIds(graph, rows)).toEqual([5, 6]);
  });

  it('resolves a source to a managed entry before any listed name, so a label never reads a namesake (sections 4-5)', () => {
    // #6 is an unrelated device whose listed name equals the label of the entry bound to #5.
    const rows = [row(5, 'Combiner'), row(6, 'hills mix'), row(7, 'Erosion')];
    const graph = spec([
      { name: 'hills mix', id: 5, type: 'Combiner' },
      { name: 'Erosion', type: 'Erosion', inputs: { '1': 'HILLS MIX' } },
    ]);
    expect(referencedDeviceIds(graph, rows)).toEqual([5, 7]);
  });

  it('names the unread devices that share the name of a read input source, once each (revision 6)', () => {
    const rows = [
      row(1, 'Combiner'),
      row(2, 'Combiner'),
      row(3, 'Combiner'),
      row(7, 'Erosion'),
      row(8, 'Base'),
    ];
    const read = [
      detail(7, 'Erosion', 'Erosion', {
        inputs: [
          { port: 1, name: 'Primary Input', source: { device: 'Combiner', port: 1 } },
          { port: 2, name: 'Water input', source: { device: 'Combiner', port: 1 } },
        ],
      }),
      detail(2, 'Combiner', 'Combiner', {
        inputs: [{ port: 1, name: 'Primary Input', source: { device: 'Base', port: 1 } }],
      }),
    ];
    expect(sharedSourceIds(rows, read)).toEqual([1, 3]);
    expect(sharedSourceIds(rows, read.slice(1))).toEqual([]);
  });
});

describe('predictedSourceIds (unidentifiable-wires design section 3, revision 2)', () => {
  // Synthetic Combiners with the ports of raw/p2b-graph-edits.txt l.121-126: inputs 1 and 2, output 1.
  const combiner = (id: number) =>
    detail(id, 'Combiner', 'Combiner', {
      inputs: [
        { port: 1, name: 'Primary Input' },
        { port: 2, name: 'Primary Input' },
      ],
    });
  const read = [20, 21, 10, 11].map(combiner);
  // #12 and Base are listed and not read.
  const project = state(read, [row(12, 'Combiner'), row(30, 'Base')]);
  const pairs = (remove?: string[]) =>
    spec(
      [
        { name: 'a mix', id: 20, type: 'Combiner', inputs: { '1': '#10' } },
        { name: 'b mix', id: 21, type: 'Combiner', inputs: { '1': '#11' } },
      ],
      remove,
    );

  it('names the unread devices of a spec source name that several predicted devices share', () => {
    expect(predictedSourceIds(pairs(), project.devices, project.details)).toEqual([12]);
  });

  it('resolves a label to its device first, and names every unread holder of that name once', () => {
    const graph = spec([
      { name: 'left', id: 10, type: 'Combiner' },
      { name: 'a mix', id: 20, type: 'Combiner', inputs: { '1': 'left', '2': 'LEFT' } },
    ]);
    const twoRead = state(
      [combiner(20), combiner(10)],
      [row(11, 'Combiner'), row(12, 'Combiner'), row(21, 'Combiner')],
    );
    expect(predictedSourceIds(graph, twoRead.devices, twoRead.details)).toEqual([11, 12, 21]);
  });

  it('leaves out a device the spec removes', () => {
    expect(predictedSourceIds(pairs(['#12']), project.devices, project.details)).toEqual([]);
  });

  it('names nothing for a unique source name or a source that matches several devices', () => {
    // Base is read, as phase one reads every unique source, so its output port exists and only its one holder stops it.
    const withBase = state([...read, detail(30, 'Base', 'Gradient')], [row(12, 'Combiner')]);
    const graph = spec([{ name: 'Eroded', type: 'Erosion', inputs: { '1': 'Base', '2': 'Combiner' } }]);
    expect(predictedSourceIds(graph, withBase.devices, withBase.details)).toEqual([]);
  });

  it('names the unread holders of a source wired into a device the plan adds', () => {
    // The Erosion matches no listed device, so the plan adds it and checks none of its ports.
    const listed = state([combiner(10)], [row(11, 'Combiner'), row(12, 'Combiner')]);
    const graph = spec([{ name: 'Eroded', type: 'Erosion', inputs: { '1': '#10' } }]);
    expect(predictedSourceIds(graph, listed.devices, listed.details)).toEqual([11, 12]);
  });

  it('reads nothing for a destination whose current source is ambiguous (revision 2, currentSource)', () => {
    // #40 and #41 are both named Old and both list 'Combiner' input 1; #20's input 1 shows 'Old'.
    const old = (id: number) =>
      detail(id, 'Old', 'Perlin Noise', { outputs: [output([{ device: 'Combiner', port: 1 }])] });
    const fed = detail(20, 'Combiner', 'Combiner', {
      inputs: [{ port: 1, name: 'Primary Input', source: { device: 'Old', port: 1 } }],
    });
    const current = state([fed, combiner(10), old(40), old(41)], [row(11, 'Combiner')]);
    const graph = spec([{ name: 'a mix', id: 20, type: 'Combiner', inputs: { '1': '#10' } }]);
    expect(planGraph(graph, current).conflicts).toEqual([
      {
        entry: 'a mix',
        reason:
          "input 1 is wired from 'Old', a name #40, #41 share, and #40, #41 each list 'Combiner' input 1 among their output targets; wire list names devices, so the wire's source cannot be identified",
      },
    ]);
    expect(predictedSourceIds(graph, current.devices, current.details)).toEqual([]);
  });

  // #40 and #41 are both named Old and neither lists 'Combiner' input 1, so #20's current source is unknown; #11 is
  // listed and not read.
  const unknownSource = state(
    [
      detail(20, 'Combiner', 'Combiner', {
        inputs: [{ port: 1, name: 'Primary Input', source: { device: 'Old', port: 1 } }],
      }),
      combiner(10),
      detail(40, 'Old', 'Perlin Noise'),
      detail(41, 'Old', 'Perlin Noise'),
    ],
    [row(11, 'Combiner')],
  );

  // Revision 2: a wire the plan refuses reads nothing; each case is a conflict of planGraph on the same spec.
  it.each<[string, RawGraphDevice[], string[] | undefined, string, GraphState?]>([
    [
      'a source the spec removes',
      [{ name: 'a mix', id: 20, type: 'Combiner', inputs: { '1': '#10' } }],
      ['#10'],
      "input source '#10' is in remove",
    ],
    [
      'an unknown input port',
      [{ name: 'a mix', id: 20, type: 'Combiner', inputs: { '3': '#10' } }],
      undefined,
      '#20 has no input port 3',
    ],
    [
      'an unknown output port',
      [{ name: 'a mix', id: 20, type: 'Combiner', inputs: { '1': '#10.2' } }],
      undefined,
      "#10 'Combiner' has no output port 2",
    ],
    [
      'a source entry that is not usable',
      [
        { name: 'left', id: 10, type: 'Gradient' },
        { name: 'a mix', id: 20, type: 'Combiner', inputs: { '1': 'left' } },
      ],
      undefined,
      "input source 'left' is a managed device with a conflict",
    ],
    [
      'a destination entry of another type',
      [{ name: 'a mix', id: 20, type: 'Gradient', inputs: { '1': '#10' } }],
      undefined,
      "#20 has type 'Combiner', not 'Gradient'",
    ],
    [
      'a destination whose current source is unknown',
      [{ name: 'a mix', id: 20, type: 'Combiner', inputs: { '1': '#10' } }],
      undefined,
      "input 1 is wired from 'Old', a name #40, #41 share, and none of them lists 'Combiner' input 1 among its output targets; wire list names devices, so the wire's source cannot be identified",
      unknownSource,
    ],
  ])('reads nothing for %s', (_label, devices, remove, reason, current = project) => {
    const graph = spec(devices, remove);
    expect(planGraph(graph, current).conflicts).toContainEqual({ entry: 'a mix', reason });
    expect(predictedSourceIds(graph, current.devices, current.details)).toEqual([]);
  });
});

describe('planId (spec v3 section 5)', () => {
  const graph = spec([{ name: 'Eroded', type: 'Erosion', parameters: { steps: 6 }, inputs: { '1': 'Old' } }]);
  const id = planId(graph, PROJECT);

  it('is stable SHA-256 hex for the same spec and state', () => {
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(planId(graph, state([OLD, ERODED]))).toBe(id);
  });

  it('sorts object keys and drops undefined fields', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: undefined }] })).toBe('{"a":[{"d":2}],"b":1}');
  });

  it.each<[string, () => string]>([
    ['the project path', () => planId(graph, { ...PROJECT, projectPath: '/r/maps/world.tmd' })],
    [
      'the spec',
      () => planId(spec([{ name: 'Eroded', type: 'Erosion', parameters: { steps: 7 } }]), PROJECT),
    ],
    [
      'a listed enabled state',
      () => planId(graph, { ...PROJECT, devices: [row(12, 'Old', false), row(20, 'Eroded')] }),
    ],
    [
      'a listed device more',
      () => planId(graph, { ...PROJECT, devices: [...PROJECT.devices, row(99, 'New')] }),
    ],
    [
      'a parameter value',
      () =>
        planId(graph, state([OLD, { ...ERODED, parameters: [{ name: 'steps', type: 'int', value: '5' }] }])),
    ],
    [
      'an input source',
      () => planId(graph, state([OLD, { ...ERODED, inputs: [{ port: 1, name: 'Primary Input' }] }])),
    ],
    [
      'enum options on a parameter row (enum-options design section 4)',
      () =>
        planId(
          graph,
          state([
            OLD,
            {
              ...ERODED,
              parameters: ERODED.parameters.map((row) =>
                row.name === 'soilMask' ? { ...row, options: ['Presence Mask'] } : row,
              ),
            },
          ]),
        ),
    ],
  ])('changes with %s', (_label, other) => {
    expect(other()).not.toBe(id);
  });
});
