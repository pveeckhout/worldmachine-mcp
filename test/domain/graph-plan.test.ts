import { describe, expect, it } from 'vitest';
import type { DeviceDetail, DeviceSummary, PortLink } from '../../src/domain/device.js';
import {
  canonicalJson,
  type GraphState,
  listedType,
  matchDevices,
  planGraph,
  planId,
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
  ])('changes with %s', (_label, other) => {
    expect(other()).not.toBe(id);
  });
});
