import { describe, expect, it } from 'vitest';
import type { DeviceDetail, DeviceSummary, PortLink } from '../../src/domain/device.js';
import { type GraphState, type PlanStep, planGraph } from '../../src/domain/graph-plan.js';
import { type RawGraphDevice, validateGraphSpec } from '../../src/domain/graph-spec.js';
import { wireLoops } from '../../src/domain/wire-loops.js';

// Synthetic devices in the shape of a Combiner, raw/p2b-graph-edits.txt l.121-126: inputs 1 and 2, output 1. A
// device's type is its name unless given, so a spec entry of that name and type manages it.
function node(
  id: number,
  name: string,
  targets: PortLink[] = [],
  sources: Readonly<Record<number, string>> = {},
  type = name,
): DeviceDetail {
  return {
    id,
    name,
    type,
    enabled: true,
    bypassed: false,
    parameters: [],
    inputs: [1, 2].map((port) => {
      const source = sources[port];
      return {
        port,
        name: 'Primary Input',
        ...(source === undefined ? {} : { source: { device: source, port: 1 } }),
      };
    }),
    outputs: [{ port: 1, name: 'Primary Output', targets }],
    portTypes: 'unknown',
  };
}

const combiner = (id: number, targets: PortLink[] = [], sources: Readonly<Record<number, string>> = {}) =>
  node(id, 'Combiner', targets, sources);
const to = (device: string, port = 1): PortLink => ({ device, port });
const row = (id: number, name: string): DeviceSummary => ({ id, name, enabled: true });

/** The listed rows are the details' rows, then `unread`. */
const state = (details: DeviceDetail[], unread: DeviceSummary[] = []): GraphState => ({
  projectPath: null,
  devices: [...details.map((detail) => row(detail.id, detail.name)), ...unread],
  details,
});

/** Plans the spec and searches its steps, as PlanGraphService does. */
function loops(devices: RawGraphDevice[], current: GraphState, remove?: string[]) {
  const graph = validateGraphSpec({ version: 1, devices, ...(remove === undefined ? {} : { remove }) });
  const plan = planGraph(graph, current);
  return { plan, ...wireLoops(graph, current, plan.steps) };
}

const closes = (wire: string, path: string): string =>
  `${wire} would close a loop (${path}); World Machine refuses a wire that closes a loop (fact 99)`;

// Hill #1 feeds Ridge #2, which feeds Peak #3: all names unique.
const HILL = node(1, 'Hill', [to('Ridge')]);
const RIDGE = node(2, 'Ridge', [to('Peak')], { 1: 'Hill' });
const PEAK = node(3, 'Peak', [], { 1: 'Ridge' });
const CHAIN = state([HILL, RIDGE, PEAK]);
const HILL_FROM_PEAK: RawGraphDevice = { name: 'Hill', type: 'Hill', inputs: { '1': 'Peak' } };

describe('wireLoops (wire-loops design section 2)', () => {
  it('refuses a wire that closes a two-device loop', () => {
    const result = loops([{ name: 'Hill', type: 'Hill', inputs: { '1': 'Ridge' } }], CHAIN);
    expect(result.plan.conflicts).toEqual([]);
    expect(result.conflicts).toEqual([
      { entry: 'Hill', reason: closes("input 1 from 'Ridge' output 1", 'Hill -> Ridge') },
    ]);
    expect(result.possibleLoops).toEqual([]);
  });

  it('refuses a wire that closes a three-device loop through an unmanaged device', () => {
    const result = loops([HILL_FROM_PEAK], CHAIN);
    expect(result.conflicts).toEqual([
      { entry: 'Hill', reason: closes("input 1 from 'Peak' output 1", 'Hill -> Ridge -> Peak') },
    ]);
    expect(result.possibleLoops).toEqual([]);
  });

  it('gives the conflict to each of two new connects that close one loop together', () => {
    const result = loops(
      [
        { name: 'Hill', type: 'Hill', inputs: { '1': 'Ridge' } },
        { name: 'Ridge', type: 'Ridge', inputs: { '2': 'Hill' } },
      ],
      state([node(1, 'Hill'), node(2, 'Ridge')]),
    );
    expect(result.conflicts).toEqual([
      { entry: 'Hill', reason: closes("input 1 from 'Ridge' output 1", 'Hill -> Ridge') },
      { entry: 'Ridge', reason: closes("input 2 from 'Hill' output 1", 'Ridge -> Hill') },
    ]);
  });

  it('follows the wires of a device the plan adds, named as its entry', () => {
    const result = loops(
      [
        { name: 'Mid', type: 'Erosion', inputs: { '1': 'Hill' } },
        { name: 'Hill', type: 'Hill', inputs: { '1': 'Mid' } },
      ],
      state([node(1, 'Hill')]),
    );
    expect(result.plan.conflicts).toEqual([]);
    expect(result.conflicts).toEqual([
      { entry: 'Mid', reason: closes("input 1 from 'Hill' output 1", 'Mid -> Hill') },
      { entry: 'Hill', reason: closes("input 1 from 'Mid' output 1", 'Hill -> Mid') },
    ]);
  });

  it('finds nothing for a chain without a loop', () => {
    // Hill -> Peak beside Hill -> Ridge -> Peak: a path leads from the source to the destination, none back.
    const result = loops([{ name: 'Peak', type: 'Peak', inputs: { '2': 'Hill' } }], CHAIN);
    expect(result.plan.steps.map((step) => step.op)).toEqual(['connect']);
    expect(result.conflicts).toEqual([]);
    expect(result.possibleLoops).toEqual([]);
  });

  it('lists a loop through a shared name it cannot follow in possibleLoops, not as a conflict', () => {
    // #10 feeds #20 and #11 feeds #21, each on input 1: both #10 and #11 list 'Combiner' input 1 (fact 82).
    const result = loops(
      [{ name: 'x', id: 10, type: 'Combiner', inputs: { '2': '#20' } }],
      state([
        combiner(10, [to('Combiner')]),
        combiner(11, [to('Combiner')]),
        combiner(20, [], { 1: 'Combiner' }),
        combiner(21, [], { 1: 'Combiner' }),
      ]),
    );
    expect(result.plan.conflicts).toEqual([]);
    expect(result.conflicts).toEqual([]);
    expect(result.possibleLoops).toEqual([
      "'x' input 2 from 'Combiner' output 1 may close a loop through 'Combiner', whose wires cannot be told apart",
    ]);
  });

  it('breaks the loop at a wire the plan disconnects', () => {
    const result = loops(
      [
        { name: 'Ridge', type: 'Ridge', inputs: { '1': null } },
        { name: 'Hill', type: 'Hill', inputs: { '1': 'Ridge' } },
      ],
      CHAIN,
    );
    expect(result.plan.steps.map((step) => step.op)).toEqual(['disconnect', 'connect']);
    expect(result.conflicts).toEqual([]);
    expect(result.possibleLoops).toEqual([]);
  });

  it('breaks the loop at a device the plan removes', () => {
    const result = loops([HILL_FROM_PEAK], CHAIN, ['Ridge']);
    expect(result.plan.steps.map((step) => step.op)).toEqual(['remove', 'connect']);
    expect(result.conflicts).toEqual([]);
    expect(result.possibleLoops).toEqual([]);
  });

  it('leaves a self-wire to its fact 98 conflict', () => {
    const result = loops([{ name: 'Hill', type: 'Hill', inputs: { '1': 'Hill' } }], CHAIN);
    expect(result.plan.conflicts).toEqual([
      {
        entry: 'Hill',
        reason:
          'input 1 is wired from the device itself; World Machine refuses a wire from a device into its own input (fact 98)',
      },
    ]);
    expect(result.conflicts).toEqual([]);
    expect(result.possibleLoops).toEqual([]);
  });

  it('does not search a wire the plan refuses', () => {
    const result = loops([{ ...HILL_FROM_PEAK, type: 'Erosion' }], CHAIN);
    expect(result.plan.conflicts).toEqual([{ entry: 'Hill', reason: "#1 has type 'Hill', not 'Erosion'" }]);
    expect(result.plan.steps).toEqual([]);
    expect(result.conflicts).toEqual([]);
    expect(result.possibleLoops).toEqual([]);
  });

  it('never searches a self-wire step, though a loop runs through its device', () => {
    // planGraph makes no step for a self-wire (fact 98); this step is built by hand. Hill and Ridge feed each other.
    const current = state([
      node(1, 'Hill', [to('Ridge')], { 1: 'Ridge' }),
      node(2, 'Ridge', [to('Hill')], { 1: 'Hill' }),
    ]);
    const graph = validateGraphSpec({
      version: 1,
      devices: [{ name: 'Hill', type: 'Hill', inputs: { '2': 'Hill' } }],
    });
    const step: PlanStep = {
      op: 'connect',
      device: 'Hill',
      id: 1,
      port: 2,
      from: 'Hill.1',
      source: { device: 'Hill', id: 1, port: 1 },
    };
    expect(wireLoops(graph, current, [step])).toEqual({ conflicts: [], possibleLoops: [] });
  });
});

describe('wireLoops hops (wire-loops plan decisions D2 to D5)', () => {
  it('follows a line into a device whose name others share when its input identifies the source', () => {
    // #6 is a second Combiner that nothing feeds; the path names #5 by id, since two devices are named Combiner.
    const result = loops(
      [HILL_FROM_PEAK],
      state([
        node(1, 'Hill', [to('Combiner')]),
        combiner(5, [to('Peak')], { 1: 'Hill' }),
        combiner(6),
        node(3, 'Peak', [], { 1: 'Combiner' }),
      ]),
    );
    expect(result.conflicts).toEqual([
      { entry: 'Hill', reason: closes("input 1 from 'Peak' output 1", 'Hill -> Combiner #5 -> Peak') },
    ]);
  });

  it('reaches no device of the line name whose input shows another source name', () => {
    // Base feeds Twin #30, which feeds nothing; Twin #31 is fed by an Other and feeds Peak. Other #41 is listed and
    // not read, so only the name tells that Base does not feed Twin #31.
    const result = loops(
      [{ name: 'Base', type: 'Base', inputs: { '1': 'Peak' } }],
      state(
        [
          node(1, 'Base', [to('Twin')]),
          node(30, 'Twin', [], { 1: 'Base' }),
          node(31, 'Twin', [to('Peak')], { 1: 'Other' }),
          node(40, 'Other', [to('Twin')]),
          node(3, 'Peak', [], { 1: 'Twin' }),
        ],
        [row(41, 'Other')],
      ),
    );
    expect(result.conflicts).toEqual([]);
    expect(result.possibleLoops).toEqual([]);
  });

  // Three devices named Base and three named Twin. The searched wire is Peak into Base #1; Peak's input 1 shows Twin.
  const base = (id: number, targets: PortLink[] = []) => node(id, 'Base', targets);
  const twin = (id: number, targets: PortLink[] = [], source?: string) =>
    node(id, 'Twin', targets, source === undefined ? {} : { 1: source });
  const peak = node(5, 'Peak', [], { 1: 'Twin', 2: 'Twin' });
  it.each<[string, RawGraphDevice[], DeviceDetail[]]>([
    [
      'the current state identifies another device of the source name',
      // Base #2 feeds Twin #31, which feeds Peak; the plan wires Base #1 into Twin #30.
      [{ name: 'm', id: 30, type: 'Twin', inputs: { '1': '#1' } }],
      [base(1), base(2, [to('Twin')]), base(3), twin(30), twin(31, [to('Peak')], 'Base'), twin(32), peak],
    ],
    [
      'the current state finds other devices of the source name',
      // Base #2 feeds Twin #31 and Base #3 feeds Twin #32, which both feed Peak; the plan wires Base #1 into Twin #30.
      [{ name: 'm', id: 30, type: 'Twin', inputs: { '1': '#1' } }],
      [
        base(1),
        base(2, [to('Twin')]),
        base(3, [to('Twin')]),
        twin(30),
        twin(31, [to('Peak')], 'Base'),
        twin(32, [to('Peak', 2)], 'Base'),
        peak,
      ],
    ],
    [
      'a connect step feeds it from another device of the source name',
      // Base #1 feeds Twin #30; the plan wires Base #2 into Twin #31, which feeds Peak.
      [{ name: 'm', id: 31, type: 'Twin', inputs: { '1': '#2' } }],
      [base(1, [to('Twin')]), base(2), base(3), twin(30, [], 'Base'), twin(31, [to('Peak')]), twin(32), peak],
    ],
  ])('reaches no device of the line name when %s', (_label, devices, details) => {
    const result = loops(
      [{ name: 'base', id: 1, type: 'Base', inputs: { '1': 'Peak' } }, ...devices],
      state(details),
    );
    expect(result.plan.conflicts).toEqual([]);
    expect(result.conflicts).toEqual([]);
    expect(result.possibleLoops).toEqual([]);
  });

  it('keeps a hop uncertain where the current state cannot tell its source, though the plan removes the other candidate', () => {
    // #10 feeds #20 and #11 feeds #21, each on input 1; with #10 removed the prediction alone would name #11 as #20's
    // source, but #20 lost its wire with #10, so the hop from #11 is only possible.
    const result = loops(
      [{ name: 'x', id: 11, type: 'Combiner', inputs: { '2': '#20' } }],
      state([
        combiner(10, [to('Combiner')]),
        combiner(11, [to('Combiner')]),
        combiner(20, [], { 1: 'Combiner' }),
        combiner(21, [], { 1: 'Combiner' }),
      ]),
      ['#10'],
    );
    expect(result.plan.conflicts).toEqual([]);
    expect(result.conflicts).toEqual([]);
    expect(result.possibleLoops).toEqual([
      "'x' input 2 from 'Combiner' output 1 may close a loop through 'Combiner', whose wires cannot be told apart",
    ]);
  });

  it('follows no target line that a disconnect left behind on a repeated line (raw/v5-read-formats.txt l.44-45)', () => {
    // World Machine lists Hill's one wire into Ridge twice; the disconnect takes one line and clears Ridge's input.
    const result = loops(
      [
        { name: 'Ridge', type: 'Ridge', inputs: { '1': null } },
        { name: 'Hill', type: 'Hill', inputs: { '1': 'Ridge' } },
      ],
      state([node(1, 'Hill', [to('Ridge'), to('Ridge')]), node(2, 'Ridge', [], { 1: 'Hill' })]),
    );
    expect(result.conflicts).toEqual([]);
    expect(result.possibleLoops).toEqual([]);
  });

  it('takes a hop as uncertain when a device of the source name was not read, though the line names one device (Codex round 1, B1)', () => {
    // Erosion #4 is listed and not read, so resolveWireSource cannot tell whether Erosion #3 feeds Peak, although Peak
    // is one device's name.
    const result = loops(
      [HILL_FROM_PEAK],
      state(
        [
          node(1, 'Hill', [to('Erosion')]),
          node(3, 'Erosion', [to('Peak')], { 1: 'Hill' }),
          node(5, 'Peak', [], { 1: 'Erosion' }),
        ],
        [row(4, 'Erosion')],
      ),
    );
    expect(result.conflicts).toEqual([]);
    expect(result.possibleLoops).toEqual([
      "'Hill' input 1 from 'Peak' output 1 may close a loop through 'Erosion', whose wires cannot be told apart",
    ]);
  });

  it('names the shared source name, not the line name, when a hop into a shared line name is uncertain', () => {
    // Erosion #4 is listed and not read; Mix #41 is fed by another name, so only Mix #40 is reached, uncertainly, and
    // the wires that cannot be told apart are the Erosions'.
    const result = loops(
      [HILL_FROM_PEAK],
      state(
        [
          node(1, 'Hill', [to('Erosion')]),
          node(3, 'Erosion', [to('Mix')], { 1: 'Hill' }),
          node(40, 'Mix', [to('Peak')], { 1: 'Erosion' }),
          node(41, 'Mix', [], { 1: 'Hill' }),
          node(5, 'Peak', [], { 1: 'Mix' }),
        ],
        [row(4, 'Erosion')],
      ),
    );
    expect(result.conflicts).toEqual([]);
    expect(result.possibleLoops).toEqual([
      "'Hill' input 1 from 'Peak' output 1 may close a loop through 'Erosion', whose wires cannot be told apart",
    ]);
  });

  it('takes a hop as uncertain when no device of the source name lists the line its input shows (revision 1)', () => {
    // An inconsistent read: Peak's input shows Erosion output 2, and neither Erosion lists Peak on an output 2, so the
    // current state identifies no other device as Peak's source.
    const peak = node(5, 'Peak');
    const result = loops(
      [HILL_FROM_PEAK],
      state([
        node(1, 'Hill', [to('Erosion')]),
        node(3, 'Erosion', [to('Peak')], { 1: 'Hill' }),
        node(4, 'Erosion'),
        { ...peak, inputs: [{ port: 1, name: 'Primary Input', source: { device: 'Erosion', port: 2 } }] },
      ]),
    );
    expect(result.conflicts).toEqual([]);
    expect(result.possibleLoops).toEqual([
      "'Hill' input 1 from 'Peak' output 1 may close a loop through 'Erosion', whose wires cannot be told apart",
    ]);
  });

  it('refuses a certain loop although an uncertain hop reaches its device first', () => {
    // #10 lists 'Combiner' input 1 (to #20, which #11 also could feed) before 'Gate' input 1; Gate feeds #20 input 2.
    const result = loops(
      [{ name: 'x', id: 10, type: 'Combiner', inputs: { '2': 'Peak' } }],
      state([
        combiner(10, [to('Combiner'), to('Gate')]),
        combiner(11, [to('Combiner')]),
        combiner(20, [to('Peak')], { 1: 'Combiner', 2: 'Gate' }),
        combiner(21, [], { 1: 'Combiner' }),
        node(30, 'Gate', [to('Combiner', 2)], { 1: 'Combiner' }),
        node(3, 'Peak', [], { 1: 'Combiner' }),
      ]),
    );
    expect(result.conflicts).toEqual([
      { entry: 'x', reason: closes("input 2 from 'Peak' output 1", 'x -> Gate -> Combiner #20 -> Peak') },
    ]);
    expect(result.possibleLoops).toEqual([]);
  });
});
