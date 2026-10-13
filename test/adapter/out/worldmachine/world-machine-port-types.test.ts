import { describe, expect, it } from 'vitest';
import {
  attachPortTypes,
  NO_PORT_TYPES,
  PORT_TYPE_CATALOG,
  WorldMachinePortTypes,
} from '../../../../src/adapter/out/worldmachine/world-machine-port-types.js';
import type { DeviceDetail } from '../../../../src/domain/device.js';
import { wireCompatibility } from '../../../../src/domain/port-types.js';
import { SYNTHETIC_CATALOG, statusOn, syntheticPortTypes } from '../../../support/port-types.js';

const HEIGHTFIELD = { id: 'o1', name: 'heightfield' };
const WATER_SYSTEM = { id: 'o2', name: 'water system' };
// raw/create-water.txt l.122-133: a Create Water as get_device reads it, wired as there.
const CREATE_WATER: DeviceDetail = {
  id: 536,
  name: 'Create Water',
  type: 'Create Water',
  enabled: true,
  bypassed: false,
  parameters: [],
  inputs: [
    { port: 1, name: 'Terrain', source: { device: 'Thermal Weathering', port: 1 } },
    { port: 2, name: 'Existing Water' },
    { port: 3, name: 'Precipitation Map' },
  ],
  outputs: [
    { port: 1, name: 'Terrain', targets: [{ device: 'Height Output', port: 1 }] },
    { port: 2, name: 'Water System', targets: [] },
    { port: 3, name: 'Tributary Mask', targets: [{ device: 'Height Output', port: 1 }] },
    { port: 4, name: 'Lake Mask', targets: [{ device: 'Height Output', port: 1 }] },
  ],
  portTypes: 'unknown',
};
// The synthetic VDM Features ports, resolved.
const VDM_PORTS = {
  inputs: [{ port: 1, name: 'Primary Input', accepts: [HEIGHTFIELD] }],
  outputs: [{ port: 1, name: 'Primary Output', type: HEIGHTFIELD }],
};

describe('WorldMachinePortTypes (port-types design sections 5 and 7)', () => {
  it("resolves a catalogued type's ports with their class names", () => {
    expect(syntheticPortTypes.portsOf('Create Water')).toEqual({
      inputs: [
        { port: 1, name: 'Terrain', accepts: [HEIGHTFIELD] },
        { port: 2, name: 'Existing Water', accepts: [WATER_SYSTEM] },
        { port: 3, name: 'Precipitation Map', accepts: [HEIGHTFIELD] },
      ],
      outputs: [
        { port: 1, name: 'Terrain', type: HEIGHTFIELD },
        { port: 2, name: 'Water System', type: WATER_SYSTEM },
        { port: 3, name: 'Tributary Mask', type: HEIGHTFIELD },
        { port: 4, name: 'Lake Mask', type: HEIGHTFIELD },
      ],
    });
  });

  it('finds an existing device by its listed type and a planned one only by an accepted add word (B1)', () => {
    expect(syntheticPortTypes.portsOf('VDM Features')).toEqual(VDM_PORTS);
    expect(syntheticPortTypes.portsOfAdded('Anisotropy')).toEqual(VDM_PORTS);
    expect(syntheticPortTypes.portsOfAdded('Twist')).toEqual(VDM_PORTS);
    expect(syntheticPortTypes.portsOfAdded('VDM Features')).toBeUndefined();
    expect(syntheticPortTypes.portsOf('Anisotropy')).toBeUndefined();
    // raw/v3-rename-types.txt l.204-205: `device add File Output` gives a Height Output.
    expect(syntheticPortTypes.portsOfAdded('File Output')).toEqual(
      syntheticPortTypes.portsOf('Height Output'),
    );
  });

  it('types nothing on another build', () => {
    const other = new WorldMachinePortTypes(statusOn(4068), SYNTHETIC_CATALOG);
    expect(other.portsOf('Create Water')).toBeUndefined();
    expect(other.portsOfAdded('Create Water')).toBeUndefined();
  });

  it('types nothing when the session holds no system info', () => {
    expect(
      new WorldMachinePortTypes(statusOn(undefined), SYNTHETIC_CATALOG).portsOf('Create Water'),
    ).toBeUndefined();
  });

  it('types nothing without a catalog (port-types plan decisions D2 and D3)', () => {
    expect(new WorldMachinePortTypes(statusOn(4067), undefined).portsOfAdded('Create Water')).toBeUndefined();
    expect(NO_PORT_TYPES.portsOf('Create Water')).toBeUndefined();
    expect(NO_PORT_TYPES.portsOfAdded('Create Water')).toBeUndefined();
  });

  it.each(['River', 'create water', 'constructor', 'toString'])(
    'finds no ports for %s, a word the catalog does not list (Review Focus 1)',
    (word) => {
      expect(syntheticPortTypes.portsOf(word)).toBeUndefined();
      expect(syntheticPortTypes.portsOfAdded(word)).toBeUndefined();
    },
  );
});

describe('attachPortTypes (port-types design section 6)', () => {
  it("gives each output its type and each input what it accepts when the ports equal the catalog's", () => {
    expect(attachPortTypes(CREATE_WATER, syntheticPortTypes.portsOf('Create Water'))).toStrictEqual({
      ...CREATE_WATER,
      inputs: [
        {
          port: 1,
          name: 'Terrain',
          source: { device: 'Thermal Weathering', port: 1 },
          accepts: ['heightfield'],
        },
        { port: 2, name: 'Existing Water', accepts: ['water system'] },
        { port: 3, name: 'Precipitation Map', accepts: ['heightfield'] },
      ],
      outputs: [
        { port: 1, name: 'Terrain', targets: [{ device: 'Height Output', port: 1 }], type: 'heightfield' },
        { port: 2, name: 'Water System', targets: [], type: 'water system' },
        {
          port: 3,
          name: 'Tributary Mask',
          targets: [{ device: 'Height Output', port: 1 }],
          type: 'heightfield',
        },
        { port: 4, name: 'Lake Mask', targets: [{ device: 'Height Output', port: 1 }], type: 'heightfield' },
      ],
      portTypes: 'catalogued',
    });
  });

  it('leaves an older version with other ports untyped (design section 5, Review Focus 3)', () => {
    const older = { ...CREATE_WATER, inputs: CREATE_WATER.inputs.slice(0, 2) };
    expect(attachPortTypes(older, syntheticPortTypes.portsOf('Create Water'))).toStrictEqual(older);
  });

  it('leaves a device untyped when its type has no catalogued ports', () => {
    expect(attachPortTypes({ ...CREATE_WATER, portTypes: 'catalogued' }, undefined)).toStrictEqual(
      CREATE_WATER,
    );
  });
});

describe('the shipped port-type catalog agrees with earlier captures (port-types plan decision D17)', () => {
  const shipped = new WorldMachinePortTypes(statusOn(4067), PORT_TYPE_CATALOG);
  // Every connect between console-added devices in raw/create-water-sea.txt (#536 and #542 Create Water, #537-539
  // Height Output from `device add File Output`, #540 Gradient, #541 Select Height), and two of
  // raw/reach-scaling-inputs.txt (#536 Reach Scaling, #537 Perlin Curve, #543 Shapes).
  it.each<[string, number, string, number, 'compatible' | 'incompatible', string]>([
    ['Create Water', 1, 'Height Output', 1, 'compatible', 'raw/create-water-sea.txt l.113-114'],
    ['Create Water', 3, 'Height Output', 1, 'compatible', 'raw/create-water-sea.txt l.116-117'],
    ['Create Water', 4, 'Height Output', 1, 'compatible', 'raw/create-water-sea.txt l.119-120'],
    ['Gradient', 1, 'Create Water', 2, 'incompatible', 'raw/create-water-sea.txt l.194-195'],
    ['Gradient', 1, 'Select Height', 1, 'compatible', 'raw/create-water-sea.txt l.240-241'],
    ['Select Height', 1, 'Create Water', 2, 'incompatible', 'raw/create-water-sea.txt l.243-244'],
    ['Create Water', 2, 'Create Water', 2, 'compatible', 'raw/create-water-sea.txt l.276-277'],
    ['Perlin Curve', 1, 'Reach Scaling', 1, 'compatible', 'raw/reach-scaling-inputs.txt l.96-97'],
    ['Shapes', 1, 'Reach Scaling', 1, 'incompatible', 'raw/reach-scaling-inputs.txt l.604-605'],
  ])('%s output %i into %s input %i is %s (%s)', (source, output, destination, input, expected) => {
    expect(
      wireCompatibility(
        shipped.portsOf(source)?.outputs.find((port) => port.port === output),
        shipped.portsOf(destination)?.inputs.find((port) => port.port === input),
      ),
    ).toBe(expected);
  });
});
