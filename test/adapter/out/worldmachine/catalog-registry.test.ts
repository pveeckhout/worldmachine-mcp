import { describe, expect, it } from 'vitest';
import { CatalogRegistry } from '../../../../src/adapter/out/worldmachine/catalog-registry.js';
import { ENUM_CATALOG_4067 } from '../../../../src/adapter/out/worldmachine/enum-options.js';
import {
  local,
  PORT_TYPE_CATALOG_4067,
  PORT_TYPE_CATALOGS,
  shipped,
  WorldMachinePortTypes,
} from '../../../../src/adapter/out/worldmachine/world-machine-port-types.js';
import { statusOn } from '../../../support/port-types.js';

const DIR = '/catalogs';
const localShort4071 = local({ ...PORT_TYPE_CATALOG_4067, build: 4071, kind: 'sample-derived' });

describe('CatalogRegistry', () => {
  it('a catalog added after startup answers the next lookup', () => {
    const registry = new CatalogRegistry({ catalogDir: DIR });
    const portTypes = new WorldMachinePortTypes(statusOn(4071), registry);
    expect(portTypes.catalogInUse()).toBeUndefined();
    registry.add(4071, { portTypes: localShort4071 });
    expect(portTypes.catalogInUse()).toEqual({ build: 4071, kind: 'sample-derived', origin: 'local' });
  });

  it('clears the load problems of the added build only', () => {
    const registry = new CatalogRegistry({
      problems: [
        `${DIR}/4071/port-types.json: bad`,
        `${DIR}/4072/port-types.json: bad`,
        `${DIR}/40710/x: bad`,
      ],
      catalogDir: DIR,
    });
    registry.add(4071, { portTypes: localShort4071 });
    expect(registry.problems()).toEqual([`${DIR}/4072/port-types.json: bad`, `${DIR}/40710/x: bad`]);
  });

  it('replaces the local catalog of the build, not the others', () => {
    const other = local({ ...PORT_TYPE_CATALOG_4067, build: 4072, kind: 'sample-derived' });
    const registry = new CatalogRegistry({ portTypes: [localShort4071, other], catalogDir: DIR });
    const next = local({ ...PORT_TYPE_CATALOG_4067, build: 4071, kind: 'strict' });
    registry.add(4071, { portTypes: next });
    expect(registry.portTypeCatalogs()).toEqual([other, next]);
  });

  it('never replaces a shipped catalog', () => {
    const registry = new CatalogRegistry({ portTypes: PORT_TYPE_CATALOGS, catalogDir: DIR });
    const portTypes = new WorldMachinePortTypes(statusOn(4067), registry);
    registry.add(4067, { portTypes: local({ ...PORT_TYPE_CATALOG_4067, kind: 'sample-derived' }) });
    expect(portTypes.catalogInUse()).toEqual({ build: 4067, kind: 'strict', origin: 'shipped' });
    expect(registry.portTypeCatalogs()).toContain(PORT_TYPE_CATALOGS[0]);
  });

  it('keeps a shipped enum catalog of the build when a local one is added', () => {
    const registry = new CatalogRegistry({ shippedEnums: [ENUM_CATALOG_4067], catalogDir: DIR });
    const added = { ...ENUM_CATALOG_4067 };
    registry.add(4067, { enumOptions: added });
    expect(registry.enumCatalogs()).toEqual([ENUM_CATALOG_4067, added]);
    expect(registry.enumCatalogs()[0]).toBe(ENUM_CATALOG_4067);
  });

  it('a second add replaces the first local enum catalog of the build', () => {
    const registry = new CatalogRegistry({ catalogDir: DIR });
    const first = { ...ENUM_CATALOG_4067, build: 4071 };
    const second = { ...ENUM_CATALOG_4067, build: 4071 };
    registry.add(4071, { enumOptions: first });
    registry.add(4071, { enumOptions: second });
    expect(registry.enumCatalogs()).toHaveLength(1);
    expect(registry.enumCatalogs()[0]).toBe(second);
  });

  it('clears only the problems of the files it was given', () => {
    const enumLine = `${DIR}/4071/enum-options.json: bad`;
    const portLine = `${DIR}/4071/port-types.json: bad`;
    const registry = new CatalogRegistry({ problems: [enumLine, portLine], catalogDir: DIR });
    registry.add(4071, { portTypes: localShort4071 });
    expect(registry.problems()).toEqual([enumLine]);
    registry.add(4071, { enumOptions: { ...ENUM_CATALOG_4067, build: 4071 } });
    expect(registry.problems()).toEqual([]);
  });

  it('refuses a catalog that is not local or not of the build', () => {
    const registry = new CatalogRegistry({ catalogDir: DIR });
    expect(() => registry.add(4071, { portTypes: shipped(PORT_TYPE_CATALOG_4067) })).toThrow();
    expect(() => registry.add(4072, { portTypes: localShort4071 })).toThrow();
    expect(() => registry.add(4072, { enumOptions: { ...ENUM_CATALOG_4067, build: 4071 } })).toThrow();
    expect(registry.portTypeCatalogs()).toEqual([]);
    expect(registry.enumCatalogs()).toEqual([]);
  });
});
