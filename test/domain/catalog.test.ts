import { describe, expect, it } from 'vitest';
import type { CatalogKind, CatalogOrigin } from '../../src/domain/catalog.js';
import { catalogLabel, selectCatalog } from '../../src/domain/catalog.js';

const c = (build: number, kind: CatalogKind, origin: CatalogOrigin) => ({ source: { build, kind, origin } });

describe('selectCatalog', () => {
  it('shipped strict beats every local catalog', () => {
    const shipped = c(4067, 'strict', 'shipped');
    expect(
      selectCatalog([c(4067, 'strict', 'local'), c(4067, 'sample-derived', 'local'), shipped], 4067),
    ).toBe(shipped);
  });
  it('a local full catalog beats a shipped sample-derived one', () => {
    const local = c(4069, 'strict', 'local');
    expect(selectCatalog([c(4069, 'sample-derived', 'shipped'), local], 4069)).toBe(local);
  });
  it('a shipped sample-derived catalog beats a local short one', () => {
    const shipped = c(4069, 'sample-derived', 'shipped');
    expect(selectCatalog([c(4069, 'sample-derived', 'local'), shipped], 4069)).toBe(shipped);
  });
  it('ignores other builds and an unknown build', () => {
    expect(selectCatalog([c(4067, 'strict', 'shipped')], 4071)).toBeUndefined();
    expect(selectCatalog([c(4067, 'strict', 'shipped')], undefined)).toBeUndefined();
  });
  it('keeps input order on ties', () => {
    const a = c(4067, 'strict', 'local');
    expect(selectCatalog([a, c(4067, 'strict', 'local')], 4067)).toBe(a);
  });
});

describe('catalogLabel', () => {
  it('labels a source', () => {
    expect(catalogLabel({ build: 4071, kind: 'sample-derived', origin: 'local' })).toBe('local short');
    expect(catalogLabel({ build: 4071, kind: 'strict', origin: 'local' })).toBe('local full');
    expect(catalogLabel({ build: 4069, kind: 'sample-derived', origin: 'shipped' })).toBe('shipped');
  });
});
