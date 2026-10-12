import { describe, expect, it } from 'vitest';
import {
  attachEnumOptions,
  type EnumCatalog,
} from '../../../../src/adapter/out/worldmachine/enum-options.js';
import type { DeviceDetail, Parameter } from '../../../../src/domain/device.js';

// Entries as raw/enum-options.txt has them, shortened: Combiner Method keeps two of its eleven options (l.1572-1578);
// Composite Type as captured (l.1748-1813; fact 86: `Type` has no options).
const CATALOG: EnumCatalog = {
  build: 4067,
  types: {
    Combiner: { Method: ['Average', 'Add'] },
    'Composite Type': { 'Pack/Unpack': ['Pack to Composite Type', 'Unpack from Composite Type'], Type: [] },
  },
};
const enumRow = (name: string, value: string): Parameter => ({ name, type: 'enum', value });
// l.1559: the Combiner's float row.
const STRENGTH: Parameter = { name: 'Strength', type: 'float', value: '0.5' };
const device = (type: string, parameters: Parameter[]): DeviceDetail => ({
  id: 1,
  name: type,
  type,
  enabled: true,
  bypassed: false,
  parameters,
  inputs: [],
  outputs: [],
});

describe('attachEnumOptions (enum-options design section 4)', () => {
  it('attaches the options of a listed value and leaves other rows as read', () => {
    expect(
      attachEnumOptions(device('Combiner', [enumRow('Method', 'Add'), STRENGTH]), 4067, CATALOG),
    ).toStrictEqual(
      device('Combiner', [{ ...enumRow('Method', 'Add'), options: ['Average', 'Add'] }, STRENGTH]),
    );
  });

  it.each([4066, undefined])('returns a device without enum rows unchanged when the build is %s', (build) => {
    const plain = device('Combiner', [STRENGTH]);
    expect(attachEnumOptions(plain, build, CATALOG)).toBe(plain);
  });

  it.each<[number | undefined, string]>([
    [4066, 'enum options omitted: the catalog is from build 4067, World Machine is build 4066'],
    [undefined, 'enum options omitted: the catalog is from build 4067, World Machine is build unknown'],
  ])('omits every option with one note when the build is %s', (build, note) => {
    const read = device('Combiner', [enumRow('Method', 'Add'), STRENGTH]);
    expect(attachEnumOptions(read, build, CATALOG)).toStrictEqual({ ...read, enumOptionsNote: [note] });
  });

  it('gives one note per distinct reason, in row order', () => {
    // Two enum rows of a type the catalog lacks give one note (River's rows, raw/enum-options.txt l.6125 and l.6132).
    const river = device('River', [
      enumRow('Planform Type', 'Simple Alignment'),
      enumRow('Channel Type', 'Curved'),
    ]);
    expect(attachEnumOptions(river, 4067, CATALOG).enumOptionsNote).toEqual([
      "no enum options known for type 'River'",
    ]);
    // A listed row keeps its options beside rows omitted for two other reasons; `Mode` is not a captured name.
    const composite = device('Composite Type', [
      enumRow('Pack/Unpack', 'Unpack from Composite Type'),
      enumRow('Type', '0'),
      enumRow('Mode', 'A'),
    ]);
    expect(attachEnumOptions(composite, 4067, CATALOG)).toStrictEqual({
      ...device('Composite Type', [
        {
          ...enumRow('Pack/Unpack', 'Unpack from Composite Type'),
          options: ['Pack to Composite Type', 'Unpack from Composite Type'],
        },
        enumRow('Type', '0'),
        enumRow('Mode', 'A'),
      ]),
      enumOptionsNote: [
        "'Type' shows '0', which the catalog does not list; its options are omitted",
        "no enum options known for 'Mode' of type 'Composite Type'",
      ],
    });
  });

  it('omits the options of a value the catalog does not list, as for a device at an older version', () => {
    expect(attachEnumOptions(device('Combiner', [enumRow('Method', 'Screen')]), 4067, CATALOG)).toStrictEqual(
      {
        ...device('Combiner', [enumRow('Method', 'Screen')]),
        enumOptionsNote: [
          "'Method' shows 'Screen', which the catalog does not list; its options are omitted",
        ],
      },
    );
  });

  it('looks up own catalog entries only, not Object.prototype members', () => {
    expect(
      attachEnumOptions(device('constructor', [enumRow('x', 'A')]), 4067, CATALOG).enumOptionsNote,
    ).toEqual(["no enum options known for type 'constructor'"]);
    expect(
      attachEnumOptions(device('Combiner', [enumRow('toString', 'A')]), 4067, CATALOG).enumOptionsNote,
    ).toEqual(["no enum options known for 'toString' of type 'Combiner'"]);
  });
});
