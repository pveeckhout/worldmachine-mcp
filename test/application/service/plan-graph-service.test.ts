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
