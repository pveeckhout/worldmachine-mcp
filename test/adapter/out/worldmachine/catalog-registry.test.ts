import { describe, expect, it } from 'vitest';
import { CatalogRegistry } from '../../../../src/adapter/out/worldmachine/catalog-registry.js';
import {
  local,
  PORT_TYPE_CATALOG_4067,
  PORT_TYPE_CATALOGS,
  WorldMachinePortTypes,
} from '../../../../src/adapter/out/worldmachine/world-machine-port-types.js';
import { statusOn } from '../../../support/port-types.js';

const DIR = '/catalogs';
const localShort4071 = local({ ...PORT_TYPE_CATALOG_4067, build: 4071, kind: 'sample-derived' });

describe('CatalogRegistry', () => {
  it('a catalog added after startup answers the next lookup', () => {
    const registry = new CatalogRegistry([], [], [], DIR);
    const portTypes = new WorldMachinePortTypes(statusOn(4071), registry);
    expect(portTypes.catalogInUse()).toBeUndefined();
    registry.add(4071, { portTypes: localShort4071 });
    expect(portTypes.catalogInUse()).toMatchObject({ build: 4071, origin: 'local' });
  });

  it('clears the load problems of the added build only', () => {
    const registry = new CatalogRegistry(
      [],
      [],
      [`${DIR}/4071/port-types.json: bad`, `${DIR}/4072/port-types.json: bad`, `${DIR}/40710/x: bad`],
      DIR,
    );
    registry.add(4071, { portTypes: localShort4071 });
    expect(registry.problems()).toEqual([`${DIR}/4072/port-types.json: bad`, `${DIR}/40710/x: bad`]);
  });

  it('replaces the local catalog of the build, not the others', () => {
    const other = local({ ...PORT_TYPE_CATALOG_4067, build: 4072, kind: 'sample-derived' });
    const registry = new CatalogRegistry([localShort4071, other], [], [], DIR);
    const next = local({ ...PORT_TYPE_CATALOG_4067, build: 4071, kind: 'strict' });
    registry.add(4071, { portTypes: next });
    expect(registry.portTypeCatalogs()).toEqual([other, next]);
  });

  it('never replaces a shipped catalog', () => {
    const registry = new CatalogRegistry(PORT_TYPE_CATALOGS, [], [], DIR);
    const portTypes = new WorldMachinePortTypes(statusOn(4067), registry);
    registry.add(4067, { portTypes: local({ ...PORT_TYPE_CATALOG_4067, kind: 'sample-derived' }) });
    expect(portTypes.catalogInUse()).toEqual({ build: 4067, kind: 'strict', origin: 'shipped' });
    expect(registry.portTypeCatalogs()).toContain(PORT_TYPE_CATALOGS[0]);
  });
});
