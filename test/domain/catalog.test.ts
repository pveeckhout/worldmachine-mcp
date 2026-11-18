import { describe, expect, it } from 'vitest';
import type { CatalogKind, CatalogOrigin, WireVerdict } from '../../src/domain/catalog.js';
import {
  catalogInfo,
  catalogLabel,
  checkDeviceTypes,
  closestStrictBase,
  correctionIndex,
  judgeVerdict,
  pairKey,
  selectCatalog,
} from '../../src/domain/catalog.js';
import type { WireCompatibility } from '../../src/domain/port-types.js';

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

describe('closestStrictBase', () => {
  it('takes the highest strict build below as the base', () => {
    const s = (build: number, kind: CatalogKind) => ({ source: { build, kind, origin: 'shipped' as const } });
    expect(
      closestStrictBase([s(4067, 'strict'), s(4069, 'sample-derived'), s(4070, 'strict')], 4071)?.source
        .build,
    ).toBe(4070);
    expect(closestStrictBase([s(4067, 'strict')], 4060)?.source.build).toBe(4067);
  });
});

describe('catalogLabel', () => {
  it('labels a source', () => {
    expect(catalogLabel({ build: 4071, kind: 'sample-derived', origin: 'local' })).toBe('local short');
    expect(catalogLabel({ build: 4071, kind: 'strict', origin: 'local' })).toBe('local full');
    expect(catalogLabel({ build: 4069, kind: 'sample-derived', origin: 'shipped' })).toBe('shipped');
  });
});

describe('port-type corrections', () => {
  const water = { type: 'Create Water', port: 'Water System' };
  const output = { type: 'Height Output', port: 'Input' };
  it('keys a pair by type and port name', () => {
    expect(pairKey(water, output)).toBe('Create Water.Water System->Height Output.Input');
  });
  it('the last verdict of a pair wins in the index', () => {
    const corr = (verdict: WireVerdict) => ({
      build: 4069,
      output: water,
      input: output,
      verdict,
      source: 'apply_graph' as const,
      at: '',
    });
    expect(correctionIndex([corr('refused'), corr('accepted')]).get(pairKey(water, output))).toBe('accepted');
  });
});

describe('judgeVerdict', () => {
  const water = { type: 'Create Water', port: 'Water System' };
  const output = { type: 'Height Output', port: 'Input' };
  const typed = (predicted: WireCompatibility) => ({ output: water, input: output, predicted });
  it('records a refusal the sample-derived catalog called compatible', () => {
    expect(judgeVerdict('sample-derived', typed('compatible'), 'refused')).toMatchObject({
      outcome: 'recorded',
      verdict: 'refused',
    });
  });
  it('records an acceptance the sample-derived catalog called a conflict', () => {
    expect(judgeVerdict('sample-derived', typed('incompatible'), 'accepted')).toMatchObject({
      outcome: 'recorded',
    });
  });
  it('says nothing when World Machine agrees', () => {
    expect(judgeVerdict('sample-derived', typed('compatible'), 'accepted')).toBeUndefined();
    expect(judgeVerdict('sample-derived', typed('incompatible'), 'refused')).toBeUndefined();
  });
  it('only reports a contradiction of a strict catalog', () => {
    expect(judgeVerdict('strict', typed('compatible'), 'refused')).toMatchObject({
      outcome: 'reported',
      reason: 'strict catalog',
    });
  });
  it('never records a pair with an adaptive end', () => {
    const fed = {
      output: { type: 'Combiner', port: 'Output' },
      input: output,
      predicted: 'compatible' as const,
    };
    expect(judgeVerdict('sample-derived', fed, 'refused')).toMatchObject({
      outcome: 'reported',
      reason: 'adaptive device',
    });
  });
  it('says nothing for an unchecked wire', () => {
    expect(judgeVerdict('sample-derived', typed('unchecked'), 'refused')).toBeUndefined();
    const untyped = { output: undefined, input: output, predicted: 'unchecked' as const };
    expect(judgeVerdict('sample-derived', untyped, 'accepted')).toBeUndefined();
  });
});

describe('catalogInfo', () => {
  const shippedSample = { build: 4069, kind: 'sample-derived', origin: 'shipped' } as const;
  it('says corrections apply', () => {
    expect(catalogInfo(4069, shippedSample, [], true).corrections).toBe(true);
  });
  it('says none apply when the build has none', () => {
    expect(catalogInfo(4069, shippedSample, [], false).corrections).toBe(false);
  });
  const minutes = { short: 11, full: 285 };
  it('offers a capture on an uncatalogued build', () => {
    expect(catalogInfo(4071, undefined, [], false, minutes).capture).toBe(
      'No catalog for build 4071. capture_catalog can capture one: short (about 11 min) or full (about 285 min). World Machine is busy for the whole run and closes the open project first; keep the mouse pointer off its window.',
    );
  });
  it('makes no offer when a catalog is in use', () => {
    expect(catalogInfo(4069, shippedSample, [], false, minutes).capture).toBeUndefined();
  });
  it('makes no offer when the build is unknown or no minutes are given', () => {
    expect(catalogInfo(undefined, undefined, [], false, minutes).capture).toBeUndefined();
    expect(catalogInfo(4071, undefined, [], false).capture).toBeUndefined();
  });
});

describe('checkDeviceTypes', () => {
  it('rejects an alias that names another type', () => {
    expect(() =>
      checkDeviceTypes([
        { addName: 'Clamp', aliases: ['Levels'], reached: true },
        { addName: 'Levels', aliases: [], reached: true },
      ]),
    ).toThrow(/alias 'Levels' of 'Clamp' names another type/);
  });
  it('accepts types whose aliases are their own', () => {
    expect(() =>
      checkDeviceTypes([
        { addName: 'Clamp', aliases: ['Rescale (Clamp)'], reached: true },
        { addName: 'Levels', aliases: [], reached: false },
      ]),
    ).not.toThrow();
  });
});
