import { describe, expect, it } from 'vitest';
import type { ProjectGraphReadPort } from '../../../src/application/port/out/project-graph-read-port.js';
import type { WorldMachineSessionPort } from '../../../src/application/port/out/world-machine-session-port.js';
import { PlanGraphService } from '../../../src/application/service/plan-graph-service.js';
import type { DeviceDetail } from '../../../src/domain/device.js';
import type { RawGraphSpec } from '../../../src/domain/graph-spec.js';
import { statusOn, syntheticPortTypes } from '../../support/port-types.js';

// raw/p2b-graph-edits.txt l.121-126: a Combiner's ports, here the existing #536.
const COMBINER: DeviceDetail = {
  id: 536,
  name: 'Combiner',
  type: 'Combiner',
  enabled: true,
  bypassed: false,
  parameters: [],
  inputs: [
    { port: 1, name: 'Primary Input' },
    { port: 2, name: 'Primary Input' },
  ],
  outputs: [{ port: 1, name: 'Primary Output', targets: [] }],
  portTypes: 'unknown',
};
const session = statusOn(4067) as unknown as WorldMachineSessionPort;
const graph: ProjectGraphReadPort = {
  listDevices: async () => [{ id: 536, name: 'Combiner', enabled: true, bypassed: false }],
  getDevice: async (device) => {
    if (device !== '#536') throw new Error(`unexpected read of ${device}`);
    return COMBINER;
  },
  getScene: async () => {
    throw new Error('not read');
  },
  inspectProject: async () => {
    throw new Error('not read');
  },
};
const SPEC: RawGraphSpec = {
  version: 1,
  devices: [
    { name: 'Lake', type: 'Create Water' },
    { name: 'Bend', type: 'River' },
    { name: 'Combiner', type: 'Combiner', inputs: { '1': 'Lake.2', '2': 'Bend' } },
  ],
};

describe('PlanGraphService port types (port-types design section 6)', () => {
  it('adds the conflict of an incompatible wire and lists a wire with an untyped end', async () => {
    const view = await new PlanGraphService(session, graph, syntheticPortTypes).planGraph({ spec: SPEC });
    expect(view.conflicts).toEqual([
      {
        entry: 'Combiner',
        reason: "'Lake' output 2 (water system) cannot feed 'Combiner' input 1, which accepts heightfield",
      },
    ]);
    expect(view.uncheckedWires).toEqual(["'Combiner' input 2"]);
    expect(view.unidentifiableWires).toEqual([]);
    expect(view.possibleLoops).toEqual([]);
    // Plan decision D7: the conflicting wire keeps its step.
    expect(view.steps.filter((step) => step.op === 'connect')).toHaveLength(2);
  });
});

describe('PlanGraphService unidentifiable wires (unidentifiable-wires design section 4)', () => {
  // Four unwired Combiners, #10, #11, #20, and #21, in the shape of COMBINER.
  const ids = [10, 11, 20, 21];
  const combiners: ProjectGraphReadPort = {
    ...graph,
    listDevices: async () => ids.map((id) => ({ id, name: 'Combiner', enabled: true, bypassed: false })),
    getDevice: async (device) => {
      const id = ids.find((candidate) => `#${candidate}` === device);
      if (id === undefined) throw new Error(`unexpected read of ${device}`);
      return { ...COMBINER, id };
    },
  };

  it('lists both inputs of two Combiner pairs on input 1 and adds no conflict', async () => {
    const view = await new PlanGraphService(session, combiners, syntheticPortTypes).planGraph({
      spec: {
        version: 1,
        devices: [
          { name: 'a mix', id: 20, type: 'Combiner', inputs: { '1': '#10' } },
          { name: 'b mix', id: 21, type: 'Combiner', inputs: { '1': '#11' } },
        ],
      },
    });
    expect(view.conflicts).toEqual([]);
    expect(view.unidentifiableWires).toEqual([
      "'a mix' input 1 from 'Combiner' output 1: #10, #11 each list 'Combiner' input 1",
      "'b mix' input 1 from 'Combiner' output 1: #10, #11 each list 'Combiner' input 1",
    ]);
  });
});

describe('PlanGraphService loops (wire-loops design section 4)', () => {
  /** Combiners in the shape of COMBINER, each listing the given output targets and input 1 source. */
  const wired = (rows: readonly (readonly [number, string[], string?])[]): ProjectGraphReadPort => ({
    ...graph,
    listDevices: async () => rows.map(([id]) => ({ id, name: 'Combiner', enabled: true, bypassed: false })),
    getDevice: async (device) => {
      const found = rows.find(([id]) => `#${id}` === device);
      if (found === undefined) throw new Error(`unexpected read of ${device}`);
      const [id, targets, source] = found;
      return {
        ...COMBINER,
        id,
        inputs: [
          {
            port: 1,
            name: 'Primary Input',
            ...(source === undefined ? {} : { source: { device: source, port: 1 } }),
          },
          { port: 2, name: 'Primary Input' },
        ],
        outputs: [
          {
            port: 1,
            name: 'Primary Output',
            targets: targets.map((target) => ({ device: target, port: 1 })),
          },
        ],
      };
    },
  });
  const spec = (inputs: Record<string, string>): RawGraphSpec => ({
    version: 1,
    devices: [{ name: 'first mix', id: 10, type: 'Combiner', inputs }],
  });

  it('adds a loop conflict and lists no possible loop', async () => {
    // #10 feeds #20 on input 1; the spec wires #20 into #10 input 2.
    const view = await new PlanGraphService(
      session,
      wired([
        [10, ['Combiner']],
        [20, [], 'Combiner'],
      ]),
      syntheticPortTypes,
    ).planGraph({ spec: spec({ '2': '#20' }) });
    expect(view.conflicts).toEqual([
      {
        entry: 'first mix',
        reason:
          "input 2 from 'Combiner' output 1 would close a loop (first mix -> Combiner #20); World Machine refuses a wire that closes a loop (fact 99)",
      },
    ]);
    expect(view.possibleLoops).toEqual([]);
  });

  it('lists a possible loop and adds no conflict', async () => {
    // #10 feeds #20 and #11 feeds #21, each on input 1, so neither of #20 and #21 tells which of #10 and #11 feeds it.
    const view = await new PlanGraphService(
      session,
      wired([
        [10, ['Combiner']],
        [11, ['Combiner']],
        [20, [], 'Combiner'],
        [21, [], 'Combiner'],
      ]),
      syntheticPortTypes,
    ).planGraph({ spec: spec({ '2': '#20' }) });
    expect(view.conflicts).toEqual([]);
    expect(view.possibleLoops).toEqual([
      "'first mix' input 2 from 'Combiner' output 1 may close a loop through 'Combiner', whose wires cannot be told apart",
    ]);
  });

  it('lists a loop through an unread sibling of an id-bound start as possible, not a conflict (Codex round 1, B1)', async () => {
    // #10 (managed by id) feeds Mid, which feeds Peak; Combiner #11 is listed and never read, so Mid's input, which
    // shows 'Combiner', may come from #11 although Mid is one device's name.
    const details: DeviceDetail[] = [
      {
        ...COMBINER,
        id: 10,
        outputs: [{ port: 1, name: 'Primary Output', targets: [{ device: 'Mid', port: 1 }] }],
      },
      {
        ...COMBINER,
        id: 5,
        name: 'Mid',
        type: 'Erosion',
        inputs: [{ port: 1, name: 'Primary Input', source: { device: 'Combiner', port: 1 } }],
        outputs: [{ port: 1, name: 'Primary Output', targets: [{ device: 'Peak', port: 1 }] }],
      },
      {
        ...COMBINER,
        id: 3,
        name: 'Peak',
        type: 'Erosion',
        inputs: [{ port: 1, name: 'Primary Input', source: { device: 'Mid', port: 1 } }],
      },
    ];
    const reads: string[] = [];
    const sibling: ProjectGraphReadPort = {
      ...graph,
      listDevices: async () => [
        { id: 10, name: 'Combiner', enabled: true, bypassed: false },
        { id: 11, name: 'Combiner', enabled: true, bypassed: false },
        { id: 5, name: 'Mid', enabled: true, bypassed: false },
        { id: 3, name: 'Peak', enabled: true, bypassed: false },
      ],
      getDevice: async (device) => {
        reads.push(device);
        const found = details.find((detail) => `#${detail.id}` === device);
        if (found === undefined) throw new Error(`unexpected read of ${device}`);
        return found;
      },
    };
    const view = await new PlanGraphService(session, sibling, syntheticPortTypes).planGraph({
      spec: spec({ '2': 'Peak' }),
    });
    expect(reads).toEqual(['#10', '#3', '#5']);
    expect(view.conflicts).toEqual([]);
    expect(view.possibleLoops).toEqual([
      "'first mix' input 2 from 'Peak' output 1 may close a loop through 'Combiner', whose wires cannot be told apart",
    ]);
  });
});
