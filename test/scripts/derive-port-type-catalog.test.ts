import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  checkSample,
  derivePortTypeCatalog,
  type PortTypeCatalogData,
} from '../../src/adapter/out/worldmachine/capture/port-type-catalog.js';
import {
  PORT_TYPE_CATALOG_4067,
  PORT_TYPE_CATALOG_4069,
} from '../../src/adapter/out/worldmachine/world-machine-port-types.js';

// Build 4069 (2026-11-17): the port-types sample (wm-4069/raw/port-types-sample.txt) checked against the full build
// 4067 catalog, for a catalog derived from it instead of a full run of several hours.
const fixture = (path: string) => fileURLToPath(new URL(`../fixtures/${path}`, import.meta.url));
const samplePath = fixture('wm-4069/raw/port-types-sample.txt');
const sample = readFileSync(samplePath, 'utf8');
const systemInfo = readFileSync(fixture('wm-4069/raw/system-info.txt'), 'utf8');
const basePath = fileURLToPath(
  new URL('../../src/adapter/out/worldmachine/port-types.4067.json', import.meta.url),
);
const base = JSON.parse(readFileSync(basePath, 'utf8')) as PortTypeCatalogData;

/** The sample with the first verdict `connected` after the first probe header turned into `refused`. */
function flippedVerdict(): string {
  const probe = sample.indexOf('>>> (probe ');
  const at = sample.indexOf(' connected\n', probe);
  return `${sample.slice(0, at)} refused\n${sample.slice(at + ' connected\n'.length)}`;
}

describe('derivePortTypeCatalog (build 4069 from the build 4067 catalog)', () => {
  const { catalog, omittedTypes } = derivePortTypeCatalog(base, sample, systemInfo);

  it('takes the build from the system info beside the sample', () => {
    expect(catalog.build).toBe(4069);
  });

  it('marks the derived catalog sample-derived', () => {
    expect(catalog.kind).toBe('sample-derived');
  });
  it('refuses a base that is not strict', () => {
    expect(() => derivePortTypeCatalog({ ...base, kind: 'sample-derived' }, sample, systemInfo)).toThrow(
      /base catalog of build 4067 is sample-derived; only a strict catalog can be a base/,
    );
  });
  it('keeps the classes and the ports of the base catalog', () => {
    expect(catalog.outputClasses).toStrictEqual(base.outputClasses);
    expect(catalog.inputClasses).toStrictEqual(base.inputClasses);
    expect(catalog.types['Create Water']?.outputs).toStrictEqual(base.types['Create Water']?.outputs);
  });

  it('keeps only the types the sample added, and names the others', () => {
    expect(Object.keys(catalog.types)).toHaveLength(116);
    expect(omittedTypes).toEqual(['Bias/Gain', 'VDM Noise']);
  });

  it('lists only the add words build 4069 accepted', () => {
    // `device add Height` is refused on 4069 as matching several devices (port-types-sample.txt l.3124).
    expect(base.types['VDM Features']?.added).toContain('Height');
    expect(catalog.types['VDM Features']?.added).not.toContain('Height');
    expect(Object.values(catalog.types).flatMap((entry) => entry.added)).toHaveLength(152);
  });

  it('fails when a type of the sample has other ports than in the base catalog', () => {
    const renamed = sample.replace('[2] Water System -> ', '[2] Water Body -> ');
    expect(() => derivePortTypeCatalog(base, renamed, systemInfo)).toThrow(
      /type '.*': other ports than in the build 4067 catalog/,
    );
  });

  it('fails when a verdict contradicts the classes of the base catalog', () => {
    expect(() => derivePortTypeCatalog(base, flippedVerdict(), systemInfo)).toThrow(
      /refused on build 4069, but the build 4067 catalog says connected/,
    );
  });

  it('names a sampled type the base lacks instead of failing', () => {
    const { 'Create Water': _, ...types } = base.types;
    const check = checkSample({ ...base, types }, sample, systemInfo);
    expect(check).toMatchObject({ agreed: true, untypedTypes: ['Create Water'] });
    expect(check.agreed && check.catalog.types['Create Water']).toBeFalsy();
  });
  it('names untyped types even when the sample disagrees', () => {
    const { 'Create Water': _, ...types } = base.types;
    expect(checkSample({ ...base, types }, flippedVerdict(), systemInfo)).toMatchObject({
      agreed: false,
      untypedTypes: ['Create Water'],
      disagreement: expect.stringContaining('but the build 4067 catalog says connected'),
    });
  });

  it('lists an add word under the type it gives on the new build, and reports the move', () => {
    // port-types-sample.txt l.14491-14492: `device add Surface` adds a Material on 4069, a VDM Repair Surface on 4067.
    const { catalog: derived, movedWords } = derivePortTypeCatalog(base, sample, systemInfo);
    expect(movedWords).toEqual([
      { word: 'Surface', from: 'VDM Repair Surface', to: 'Material' },
      { word: 'Tile', from: 'Instance Tiling', to: 'Crop & Transform' },
    ]);
    expect(derived.types.Material?.added).toContain('Surface');
    expect(derived.types['VDM Repair Surface']?.added).not.toContain('Surface');
  });
});

const script = fileURLToPath(new URL('../../scripts/derive-port-type-catalog.mjs', import.meta.url));

describe('scripts/derive-port-type-catalog.mjs', () => {
  it('prints the derived catalog and names the omitted types on stderr', () => {
    const result = spawnSync(process.execPath, [script, basePath, samplePath], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toStrictEqual(derivePortTypeCatalog(base, sample, systemInfo).catalog);
    expect(result.stderr.trim().split('\n')).toEqual([
      "omitted type 'Bias/Gain': the sample did not add it",
      "omitted type 'VDM Noise': the sample did not add it",
      "moved add word 'Surface': gives 'Material', not 'VDM Repair Surface'",
      "moved add word 'Tile': gives 'Crop & Transform', not 'Instance Tiling'",
    ]);
  });

  it('prints nothing on stdout and exits 1 when the derivation fails', () => {
    const dir = mkdtempSync(join(tmpdir(), 'derive-port-types-'));
    try {
      writeFileSync(join(dir, 'port-types-sample.txt'), flippedVerdict());
      copyFileSync(fixture('wm-4069/raw/system-info.txt'), join(dir, 'system-info.txt'));
      const result = spawnSync(process.execPath, [script, basePath, join(dir, 'port-types-sample.txt')], {
        encoding: 'utf8',
      });
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('but the build 4067 catalog says connected');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits 2 with a usage line without both arguments', () => {
    const result = spawnSync(process.execPath, [script, basePath], { encoding: 'utf8' });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('usage: node scripts/derive-port-type-catalog.mjs');
  });
});

describe('the shipped build 4069 port-type catalog', () => {
  it('is exactly what the build 4067 catalog and the 4069 sample derive to (parity)', () => {
    expect(PORT_TYPE_CATALOG_4069).toStrictEqual(derivePortTypeCatalog(base, sample, systemInfo).catalog);
    expect(PORT_TYPE_CATALOG_4067).toStrictEqual(base);
  });
});
