import { describe, expect, it } from 'vitest';
import {
  readEnumCatalog,
  readPortTypeCatalog,
} from '../../../../src/adapter/out/worldmachine/catalog-reader.js';
import { ENUM_CATALOG_4069 } from '../../../../src/adapter/out/worldmachine/enum-options.js';
import { PORT_TYPE_CATALOG_4069 } from '../../../../src/adapter/out/worldmachine/world-machine-port-types.js';

// biome-ignore lint/suspicious/noExplicitAny: tests break catalogs on purpose
const clone = (value: unknown): any => structuredClone(value);

describe('readPortTypeCatalog', () => {
  it('reads the shipped catalogs', () => {
    expect(readPortTypeCatalog(JSON.parse(JSON.stringify(PORT_TYPE_CATALOG_4069)))).toStrictEqual(
      PORT_TYPE_CATALOG_4069,
    );
    expect(readEnumCatalog(JSON.parse(JSON.stringify(ENUM_CATALOG_4069)))).toStrictEqual(ENUM_CATALOG_4069);
  });

  it('rejects a value that is not an object', () => {
    expect(() => readPortTypeCatalog(null)).toThrow(/not an object/);
    expect(() => readPortTypeCatalog([])).toThrow(/not an object/);
  });

  it('rejects a build that is not a positive integer', () => {
    for (const build of [0, -1, 4069.5, '4069']) {
      const broken = clone(PORT_TYPE_CATALOG_4069);
      broken.build = build;
      expect(() => readPortTypeCatalog(broken)).toThrow(/build must be a positive integer/);
    }
  });

  it('rejects a catalog without a kind', () => {
    const { kind: _, ...rest } = PORT_TYPE_CATALOG_4069;
    expect(() => readPortTypeCatalog(rest)).toThrow(/kind must be 'strict' or 'sample-derived'/);
  });

  it('rejects a type without its arrays', () => {
    const broken = clone(PORT_TYPE_CATALOG_4069);
    delete broken.types['Create Water'].added;
    expect(() => readPortTypeCatalog(broken)).toThrow(/type 'Create Water': added must be an array/);
  });

  it('rejects an output whose class is missing', () => {
    const broken = clone(PORT_TYPE_CATALOG_4069);
    broken.types['Create Water'].outputs[0].class = 'nope';
    expect(() => readPortTypeCatalog(broken)).toThrow(/type 'Create Water' output 1: no output class 'nope'/);
  });

  it('rejects an input whose class is missing', () => {
    const broken = clone(PORT_TYPE_CATALOG_4069);
    broken.types['Create Water'].inputs[0].class = 'nope';
    expect(() => readPortTypeCatalog(broken)).toThrow(/type 'Create Water' input 1: no input class 'nope'/);
  });

  it('rejects an input class naming an output class that does not exist', () => {
    const broken = clone(PORT_TYPE_CATALOG_4069);
    broken.inputClasses.i2 = ['nope'];
    expect(() => readPortTypeCatalog(broken)).toThrow(/input class 'i2': no output class 'nope'/);
  });
});

describe('readEnumCatalog', () => {
  it('rejects a non-integer build', () => {
    const broken = clone(ENUM_CATALOG_4069);
    broken.build = 'x';
    expect(() => readEnumCatalog(broken)).toThrow(/build must be an integer/);
  });

  it('rejects a type without parameters', () => {
    const broken = clone(ENUM_CATALOG_4069);
    broken.types['Add Noise'].parameters = 'x';
    expect(() => readEnumCatalog(broken)).toThrow(/type 'Add Noise': parameters must be an array of strings/);
  });

  it('rejects a type whose enums are not string arrays', () => {
    const broken = clone(ENUM_CATALOG_4069);
    broken.types['Add Noise'].enums['Noise Type'] = [1];
    expect(() => readEnumCatalog(broken)).toThrow(
      /type 'Add Noise': enums 'Noise Type' must be an array of strings/,
    );
  });
});
