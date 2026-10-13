import { describe, expect, it } from 'vitest';
import {
  acceptsText,
  type CataloguedPorts,
  fingerprintMatches,
  type PortNames,
  refusalTypes,
  typedPorts,
  uncheckedWire,
  wireCompatibility,
  wireConflictReason,
} from '../../src/domain/port-types.js';

// Synthetic classes (port-types plan decision D1): no port-type capture exists before plan Task 11.
const HEIGHTFIELD = { id: 'o1', name: 'heightfield' };
const WATER_SYSTEM = { id: 'o2', name: 'water system' };
const MASK = { id: 'o3', name: 'mask' };
// raw/create-water.txt l.122-133: a Create Water's ports, with the synthetic classes.
const TERRAIN_IN = { port: 1, name: 'Terrain', accepts: [HEIGHTFIELD, MASK] };
const EXISTING_WATER = { port: 2, name: 'Existing Water', accepts: [WATER_SYSTEM] };
const PRECIPITATION = { port: 3, name: 'Precipitation Map', accepts: [HEIGHTFIELD, MASK] };
const TERRAIN_OUT = { port: 1, name: 'Terrain', type: HEIGHTFIELD };
const WATER_OUT = { port: 2, name: 'Water System', type: WATER_SYSTEM };
const CREATE_WATER: CataloguedPorts = {
  inputs: [TERRAIN_IN, EXISTING_WATER, PRECIPITATION],
  outputs: [
    TERRAIN_OUT,
    WATER_OUT,
    { port: 3, name: 'Tributary Mask', type: MASK },
    { port: 4, name: 'Lake Mask', type: MASK },
  ],
};
// The same ports as `wire list` shows them (raw/create-water.txt l.122-133).
const LISTED: PortNames = {
  inputs: [
    { port: 1, name: 'Terrain' },
    { port: 2, name: 'Existing Water' },
    { port: 3, name: 'Precipitation Map' },
  ],
  outputs: [
    { port: 1, name: 'Terrain' },
    { port: 2, name: 'Water System' },
    { port: 3, name: 'Tributary Mask' },
    { port: 4, name: 'Lake Mask' },
  ],
};

describe('fingerprintMatches (port-types design section 5)', () => {
  it('matches a device whose port names, inputs and outputs in order, equal the catalogued ones', () => {
    expect(fingerprintMatches(LISTED, CREATE_WATER)).toBe(true);
  });

  it.each<[string, PortNames]>([
    [
      'an input of another name',
      {
        ...LISTED,
        inputs: [
          { port: 1, name: 'Terrain' },
          { port: 2, name: 'Water input' },
          { port: 3, name: 'Precipitation Map' },
        ],
      },
    ],
    ['one input fewer', { ...LISTED, inputs: LISTED.inputs.slice(0, 2) }],
    ['one output more', { ...LISTED, outputs: [...LISTED.outputs, { port: 5, name: 'Flow' }] }],
    [
      'two outputs in another order',
      {
        ...LISTED,
        outputs: [
          { port: 1, name: 'Water System' },
          { port: 2, name: 'Terrain' },
          { port: 3, name: 'Tributary Mask' },
          { port: 4, name: 'Lake Mask' },
        ],
      },
    ],
  ])('does not match an older version with %s (design section 2)', (_label, ports) => {
    expect(fingerprintMatches(ports, CREATE_WATER)).toBe(false);
  });
});

describe('typedPorts (port-types plan decision D5)', () => {
  it('returns the catalogued ports of a device that passes the fingerprint', () => {
    expect(typedPorts(LISTED, CREATE_WATER)).toBe(CREATE_WATER);
  });

  it('returns undefined for other ports or a type without catalogued ports', () => {
    expect(typedPorts({ ...LISTED, inputs: [] }, CREATE_WATER)).toBeUndefined();
    expect(typedPorts(LISTED, undefined)).toBeUndefined();
  });
});

describe('wireCompatibility (port-types design section 7)', () => {
  it('is compatible when the input accepts the output class', () => {
    expect(wireCompatibility(WATER_OUT, EXISTING_WATER)).toBe('compatible');
  });

  it('is incompatible when it does not', () => {
    expect(wireCompatibility(WATER_OUT, TERRAIN_IN)).toBe('incompatible');
    expect(wireCompatibility(TERRAIN_OUT, EXISTING_WATER)).toBe('incompatible');
  });

  it('is unchecked when an end is untyped', () => {
    expect(wireCompatibility(undefined, EXISTING_WATER)).toBe('unchecked');
    expect(wireCompatibility(WATER_OUT, undefined)).toBe('unchecked');
  });
});

describe('port-type texts (port-types design section 6, plan decision D15)', () => {
  it('describes an input by the names of the classes it accepts, or as accepting nothing', () => {
    expect(acceptsText(TERRAIN_IN)).toBe('heightfield, mask');
    expect(acceptsText({ port: 9, name: 'Unfed', accepts: [] })).toBe('nothing');
  });

  it('gives the conflict reason of plan_graph', () => {
    expect(wireConflictReason('Lake', WATER_OUT, 'Sea', TERRAIN_IN)).toBe(
      "'Lake' output 2 (water system) cannot feed 'Sea' input 1, which accepts heightfield, mask",
    );
  });

  it('gives the text a refused connect appends', () => {
    expect(refusalTypes(WATER_OUT, TERRAIN_IN)).toBe(
      ': output 2 is water system; input 1 accepts heightfield, mask',
    );
  });

  it('names an unchecked wire by its destination entry and port', () => {
    expect(uncheckedWire('Sea', 2)).toBe("'Sea' input 2");
  });
});
