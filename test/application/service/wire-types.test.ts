import { describe, expect, it } from 'vitest';
import type { PortTypeCatalogPort } from '../../../src/application/port/out/port-type-catalog-port.js';
import { checkWireTypes } from '../../../src/application/service/wire-types.js';
import type { DeviceDetail } from '../../../src/domain/device.js';
import { type GraphState, planGraph } from '../../../src/domain/graph-plan.js';
import { type RawGraphSpec, validateGraphSpec } from '../../../src/domain/graph-spec.js';
import { syntheticPortTypes } from '../../support/port-types.js';

const EMPTY: GraphState = { projectPath: null, devices: [], details: [] };
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
// raw/p2a-edge-cases.txt l.38-42: a Gradient's ports, here the existing #537.
const GRADIENT: DeviceDetail = {
  id: 537,
  name: 'Gradient',
  type: 'Gradient',
  enabled: true,
  bypassed: false,
  parameters: [],
  inputs: [],
  outputs: [{ port: 1, name: 'Primary Output', targets: [] }],
  portTypes: 'unknown',
};
const stateOf = (...details: DeviceDetail[]): GraphState => ({
  projectPath: null,
  devices: details.map(({ id, name, enabled, bypassed }) => ({ id, name, enabled, bypassed })),
  details,
});
const NO_TYPES: PortTypeCatalogPort = { portsOf: () => undefined, portsOfAdded: () => undefined };

/** checkWireTypes over the steps planGraph makes for `raw` (port-types design section 6). */
function check(
  raw: RawGraphSpec,
  state: GraphState = EMPTY,
  portTypes: PortTypeCatalogPort = syntheticPortTypes,
) {
  const spec = validateGraphSpec(raw);
  return checkWireTypes(spec, state, planGraph(spec, state).steps, portTypes);
}
const LAKE = { name: 'Lake', type: 'Create Water' };
const WATER_INTO_COMBINER =
  "'Lake' output 2 (water system) cannot feed 'Combiner' input 1, which accepts heightfield";

describe('checkWireTypes (port-types design sections 5 and 6)', () => {
  it('reports a wire into a planned device whose input does not accept the output as a conflict', () => {
    expect(
      check({
        version: 1,
        devices: [LAKE, { name: 'Combiner', type: 'Combiner', inputs: { '1': 'Lake.2' } }],
      }),
    ).toEqual({ conflicts: [{ entry: 'Combiner', reason: WATER_INTO_COMBINER }], uncheckedWires: [] });
  });

  it('reports the same wire into an existing device as a conflict', () => {
    expect(
      check(
        { version: 1, devices: [LAKE, { name: 'Combiner', type: 'Combiner', inputs: { '1': 'Lake.2' } }] },
        stateOf(COMBINER),
      ),
    ).toEqual({ conflicts: [{ entry: 'Combiner', reason: WATER_INTO_COMBINER }], uncheckedWires: [] });
  });

  it('reports an existing source that a planned input does not accept', () => {
    expect(
      check({ version: 1, devices: [{ ...LAKE, inputs: { '2': 'Gradient' } }] }, stateOf(GRADIENT)),
    ).toEqual({
      conflicts: [
        {
          entry: 'Lake',
          reason: "'Gradient' output 1 (heightfield) cannot feed 'Lake' input 2, which accepts water system",
        },
      ],
      uncheckedWires: [],
    });
  });

  it('passes a wire the input accepts', () => {
    expect(
      check({
        version: 1,
        devices: [LAKE, { name: 'Sea', type: 'Create Water', inputs: { '2': 'Lake.2' } }],
      }),
    ).toEqual({ conflicts: [], uncheckedWires: [] });
  });

  it('types a planned device by an accepted add word: Anisotropy adds a VDM Features (B1, Review Focus 1)', () => {
    expect(
      check({
        version: 1,
        devices: [
          { name: 'Relief', type: 'Anisotropy' },
          { ...LAKE, inputs: { '2': 'Relief' } },
        ],
      }),
    ).toEqual({
      conflicts: [
        {
          entry: 'Lake',
          reason: "'Relief' output 1 (heightfield) cannot feed 'Lake' input 2, which accepts water system",
        },
      ],
      uncheckedWires: [],
    });
  });

  it('types a planned File Output, an add word for Height Output (raw/v3-rename-types.txt l.204-205, B1)', () => {
    expect(
      check({ version: 1, devices: [LAKE, { name: 'Out', type: 'File Output', inputs: { '1': 'Lake.2' } }] }),
    ).toEqual({
      conflicts: [
        {
          entry: 'Out',
          reason: "'Lake' output 2 (water system) cannot feed 'Out' input 1, which accepts heightfield",
        },
      ],
      uncheckedWires: [],
    });
  });

  it('lists unchecked a planned type that is a listed name but no accepted add word (B1, Review Focus 1)', () => {
    expect(
      check({
        version: 1,
        devices: [
          { name: 'Relief', type: 'VDM Features' },
          { ...LAKE, inputs: { '2': 'Relief' } },
        ],
      }),
    ).toEqual({ conflicts: [], uncheckedWires: ["'Lake' input 2"] });
  });

  it('lists a wire unchecked when a type is not catalogued', () => {
    expect(
      check({
        version: 1,
        devices: [
          { name: 'Bend', type: 'River' },
          { name: 'Combiner', type: 'Combiner', inputs: { '1': 'Bend' } },
        ],
      }),
    ).toEqual({ conflicts: [], uncheckedWires: ["'Combiner' input 1"] });
  });

  it('lists a wire unchecked for a type given in another case (Review Focus 1)', () => {
    expect(
      check({
        version: 1,
        devices: [
          { name: 'Lake', type: 'create water' },
          { name: 'Combiner', type: 'Combiner', inputs: { '1': 'Lake.2' } },
        ],
      }),
    ).toEqual({ conflicts: [], uncheckedWires: ["'Combiner' input 1"] });
  });

  it('lists a wire unchecked when a catalogued type has no such port (Review Focus 2)', () => {
    expect(
      check({
        version: 1,
        devices: [LAKE, { name: 'Combiner', type: 'Combiner', inputs: { '1': 'Lake.7', '5': 'Lake.2' } }],
      }),
    ).toEqual({ conflicts: [], uncheckedWires: ["'Combiner' input 1", "'Combiner' input 5"] });
  });

  it('lists a wire unchecked when an existing end has other ports than the catalog (Review Focus 3)', () => {
    const older: DeviceDetail = { ...COMBINER, inputs: [...COMBINER.inputs, { port: 3, name: 'Mask' }] };
    expect(
      check(
        { version: 1, devices: [LAKE, { name: 'Combiner', type: 'Combiner', inputs: { '1': 'Lake.2' } }] },
        stateOf(older),
      ),
    ).toEqual({ conflicts: [], uncheckedWires: ["'Combiner' input 1"] });
  });

  it('checks nothing for a wire the spec keeps (plan decision D7, Review Focus 4)', () => {
    const wired: DeviceDetail = {
      ...COMBINER,
      inputs: [
        { port: 1, name: 'Primary Input', source: { device: 'Gradient', port: 1 } },
        { port: 2, name: 'Primary Input' },
      ],
    };
    expect(
      check(
        { version: 1, devices: [{ name: 'Combiner', type: 'Combiner', inputs: { '1': 'Gradient' } }] },
        stateOf(wired, GRADIENT),
        NO_TYPES,
      ),
    ).toEqual({ conflicts: [], uncheckedWires: [] });
  });
});
