import { describe, expect, it } from 'vitest';
import type { DeviceDetail, PortLink } from '../../src/domain/device.js';
import { type GraphState, type PlanStep, planGraph } from '../../src/domain/graph-plan.js';
import { type RawGraphDevice, validateGraphSpec } from '../../src/domain/graph-spec.js';
import { unidentifiableWires } from '../../src/domain/wire-prediction.js';

// Synthetic devices in the shape of raw/p2b-graph-edits.txt l.121-126 (a Combiner's two inputs and one output).
const C1: PortLink = { device: 'Combiner', port: 1 };

/** A Combiner with the given output target lines and input sources (each from output port 1). */
function combiner(
  id: number,
  targets: PortLink[] = [],
  sources: Readonly<Record<number, string>> = {},
  name = 'Combiner',
): DeviceDetail {
  return {
    id,
    name,
    type: 'Combiner',
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

const state = (details: DeviceDetail[]): GraphState => ({
  projectPath: null,
  devices: details.map((detail) => ({ id: detail.id, name: detail.name, enabled: true })),
  details,
});

const spec = (devices: RawGraphDevice[], remove?: string[]) =>
  validateGraphSpec({ version: 1, devices, ...(remove === undefined ? {} : { remove }) });

/** Plans the spec and predicts from its steps, as PlanGraphService does. */
function predict(devices: RawGraphDevice[], details: DeviceDetail[], remove?: string[]) {
  const graph = spec(devices, remove);
  const read = state(details);
  const plan = planGraph(graph, read);
  return { plan, wires: unidentifiableWires(graph, read, plan.steps) };
}

const mix = (name: string, id: number, inputs?: Record<string, string | null>): RawGraphDevice => ({
  name,
  id,
  type: 'Combiner',
  ...(inputs === undefined ? {} : { inputs }),
});

const BOTH = "#10, #11 each list 'Combiner' input 1";

describe('unidentifiableWires (unidentifiable-wires design section 2)', () => {
  it('lists both inputs of two planned Combiner-into-Combiner pairs on input 1', () => {
    const { plan, wires } = predict(
      [mix('a mix', 20, { '1': '#10' }), mix('b mix', 21, { '1': '#11' })],
      [combiner(10), combiner(11), combiner(20), combiner(21)],
    );
    expect(plan.conflicts).toEqual([]);
    expect(wires).toEqual([
      `'a mix' input 1 from 'Combiner' output 1: ${BOTH}`,
      `'b mix' input 1 from 'Combiner' output 1: ${BOTH}`,
    ]);
  });

  it('lists the destinations in spec entry order', () => {
    const { wires } = predict(
      [mix('b mix', 21, { '1': '#11' }), mix('a mix', 20, { '1': '#10' })],
      [combiner(10), combiner(11), combiner(20), combiner(21)],
    );
    expect(wires).toEqual([
      `'b mix' input 1 from 'Combiner' output 1: ${BOTH}`,
      `'a mix' input 1 from 'Combiner' output 1: ${BOTH}`,
    ]);
  });

  it('lists nothing for one planned pair', () => {
    const { wires } = predict(
      [mix('a mix', 20, { '1': '#10' })],
      [combiner(10), combiner(11), combiner(20), combiner(21)],
    );
    expect(wires).toEqual([]);
  });

  it('lists nothing for two pairs on different input numbers', () => {
    const { wires } = predict(
      [mix('a mix', 20, { '1': '#10' }), mix('b mix', 21, { '2': '#11' })],
      [combiner(10), combiner(11), combiner(20), combiner(21)],
    );
    expect(wires).toEqual([]);
  });

  it('lists an existing managed wire that a planned sibling pair makes ambiguous', () => {
    const { plan, wires } = predict(
      [mix('a mix', 20), mix('b mix', 21, { '1': '#11' })],
      [combiner(10, [C1]), combiner(11), combiner(20, [], { 1: 'Combiner' }), combiner(21)],
    );
    expect(plan.unchanged).toEqual(['a mix']);
    expect(wires).toEqual([
      `'a mix' input 1 from 'Combiner' output 1: ${BOTH}`,
      `'b mix' input 1 from 'Combiner' output 1: ${BOTH}`,
    ]);
  });

  it('does not list an input that is already a conflict, nor a kept wire the current state cannot identify', () => {
    const { plan, wires } = predict(
      [mix('a mix', 20, { '1': '#10' }), mix('b mix', 21)],
      [
        combiner(10, [C1]),
        combiner(11, [C1]),
        combiner(20, [], { 1: 'Combiner' }),
        combiner(21, [], { 1: 'Combiner' }),
      ],
    );
    expect(plan.conflicts.map((conflict) => conflict.entry)).toEqual(['a mix']);
    expect(wires).toEqual([]);
  });

  it('leaves unlisted an ambiguity that a disconnect step clears', () => {
    const { plan, wires } = predict(
      [mix('a mix', 20, { '1': null }), mix('b mix', 21, { '1': '#11' })],
      [combiner(10, [C1]), combiner(11), combiner(20, [], { 1: 'Combiner' }), combiner(21)],
    );
    expect(plan.steps.map((step) => step.op)).toEqual(['disconnect', 'connect']);
    expect(wires).toEqual([]);
  });

  it('leaves unlisted an ambiguity that a removed device clears', () => {
    const { plan, wires } = predict(
      [mix('a mix', 20), mix('b mix', 21, { '1': '#11' })],
      [combiner(10, [C1]), combiner(11), combiner(20, [], { 1: 'Combiner' }), combiner(21)],
      ['#10'],
    );
    expect(plan.steps.map((step) => step.op)).toEqual(['remove', 'connect']);
    expect(wires).toEqual([]);
  });

  it('takes one target line off for a disconnect, so a second wire of that output still counts', () => {
    // #10 feeds input 1 of #20 and of #21; the plan moves #20's input to #11, so #10 and #11 each list it.
    const { plan, wires } = predict(
      [mix('a mix', 20, { '1': '#11' }), mix('b mix', 21)],
      [
        combiner(10, [C1, C1]),
        combiner(11),
        combiner(20, [], { 1: 'Combiner' }),
        combiner(21, [], { 1: 'Combiner' }),
      ],
    );
    expect(plan.conflicts).toEqual([]);
    expect(plan.steps.map((step) => step.op)).toEqual(['disconnect', 'connect']);
    expect(wires).toEqual([
      `'a mix' input 1 from 'Combiner' output 1: ${BOTH}`,
      `'b mix' input 1 from 'Combiner' output 1: ${BOTH}`,
    ]);
  });

  it('lists a wire whose old source repeats its target line, the documented over-report (spec revision 2)', () => {
    // #10 lists 'Combiner' input 1 twice for its one wire into #20 (raw/v5-read-formats.txt l.44-45). The plan
    // moves #20's input to #11; the disconnect takes one line off, so #10 still lists it and both qualify.
    const { plan, wires } = predict(
      [mix('a mix', 20, { '1': '#11' })],
      [combiner(10, [C1, C1]), combiner(11), combiner(20, [], { 1: 'Combiner' }), combiner(21)],
    );
    expect(plan.steps.map((step) => step.op)).toEqual(['disconnect', 'connect']);
    expect(wires).toEqual([`'a mix' input 1 from 'Combiner' output 1: ${BOTH}`]);
  });

  it('lists a new wire beside removed devices whose sources stay ambiguous, the documented over-report (spec revision 2)', () => {
    // #10 and #11 feed input 1 of #22 and #23, both named Mixer, so neither removed input's source is identified
    // and both lines stay; the new wire from #12 into the Mixer #20 then has three candidates.
    const mixer = (id: number, sources: Readonly<Record<number, string>> = {}) =>
      combiner(id, [], sources, 'Mixer');
    const M1: PortLink = { device: 'Mixer', port: 1 };
    const { plan, wires } = predict(
      [mix('a mix', 20, { '1': '#12' })],
      [
        combiner(10, [M1]),
        combiner(11, [M1]),
        combiner(12),
        mixer(20),
        mixer(22, { 1: 'Combiner' }),
        mixer(23, { 1: 'Combiner' }),
      ],
      ['#22', '#23'],
    );
    expect(plan.conflicts).toEqual([]);
    expect(plan.steps.map((step) => step.op)).toEqual(['remove', 'remove', 'connect']);
    expect(wires).toEqual([
      "'a mix' input 1 from 'Combiner' output 1: #10, #11, #12 each list 'Mixer' input 1",
    ]);
  });

  it('takes the line into a removed device off its identified source', () => {
    // #10 feeds the Mixer #22, which the plan removes; without the cut, #10 would still list 'Mixer' input 1.
    const M1: PortLink = { device: 'Mixer', port: 1 };
    const { plan, wires } = predict(
      [mix('a mix', 20, { '1': '#12' })],
      [
        combiner(10, [M1]),
        combiner(11),
        combiner(12),
        combiner(20, [], {}, 'Mixer'),
        combiner(22, [], { 1: 'Combiner' }, 'Mixer'),
      ],
      ['#22'],
    );
    expect(plan.steps.map((step) => step.op)).toEqual(['remove', 'connect']);
    expect(wires).toEqual([]);
  });

  it('clears a managed input whose identified source is removed', () => {
    // #10 feeds a mix's input 1 and is removed, so that input has no wire after the apply.
    const { plan, wires } = predict(
      [mix('a mix', 20), mix('b mix', 21, { '1': '#11' }), mix('c mix', 22, { '1': '#12' })],
      [
        combiner(10, [C1]),
        combiner(11),
        combiner(12),
        combiner(20, [], { 1: 'Combiner' }),
        combiner(21),
        combiner(22),
      ],
      ['#10'],
    );
    expect(plan.conflicts).toEqual([]);
    const both = "#11, #12 each list 'Combiner' input 1";
    expect(wires).toEqual([
      `'b mix' input 1 from 'Combiner' output 1: ${both}`,
      `'c mix' input 1 from 'Combiner' output 1: ${both}`,
    ]);
  });

  it('names a planned candidate as the planned entry (unidentifiable-wires plan decision D5)', () => {
    // Hand-built steps: planGraph never adds a device whose name a listed device has (plan decision D5).
    const graph = spec([mix('a mix', 20), mix('b mix', 21)]);
    const read = state([
      combiner(10, [{ device: 'Mixer', port: 1 }]),
      combiner(20, [], { 1: 'Combiner' }, 'Mixer'),
      combiner(21, [], {}, 'Mixer'),
    ]);
    const steps: PlanStep[] = [
      { op: 'add', device: 'Combiner', type: 'Combiner' },
      {
        op: 'connect',
        device: 'b mix',
        id: 21,
        port: 1,
        from: 'Combiner.1',
        source: { device: 'Combiner', port: 1 },
      },
    ];
    const both = "#10, the planned 'Combiner' each list 'Mixer' input 1";
    expect(unidentifiableWires(graph, read, steps)).toEqual([
      `'a mix' input 1 from 'Combiner' output 1: ${both}`,
      `'b mix' input 1 from 'Combiner' output 1: ${both}`,
    ]);
  });

  it('lists nothing for an empty spec and plan', () => {
    expect(unidentifiableWires(spec([]), state([]), [])).toEqual([]);
  });
});
