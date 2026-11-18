import { mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FsCatalogInstaller } from '../../../../src/adapter/out/fs/fs-catalog-installer.js';
import { FsLocalCatalogs } from '../../../../src/adapter/out/fs/fs-local-catalogs.js';
import { FsPortTypeCorrections } from '../../../../src/adapter/out/fs/fs-port-type-corrections.js';
import type { CatalogInstall } from '../../../../src/application/port/out/install-catalog-port.js';
import type { EnumCatalog, PortTypeCatalog } from '../../../../src/domain/catalog.js';
import { captureLogger } from '../../../support/fake-wm.js';

const portTypes = (build: number, extra = ''): PortTypeCatalog => ({
  build,
  kind: 'strict',
  outputClasses: { '1': `Heightfield${extra}` },
  inputClasses: { '1': ['1'] },
  types: {
    Perlin: { added: ['Perlin'], inputs: [], outputs: [{ port: 1, name: 'Output', class: '1' }] },
  },
});
const enums = (build: number): EnumCatalog => ({
  build,
  types: { Perlin: { parameters: ['Scale'], enums: {} } },
});
const entry = (build = 4071, extra = ''): CatalogInstall => ({
  build,
  enumOptions: enums(build),
  portTypes: portTypes(build, extra),
  record: {
    mode: 'full',
    date: '2026-11-18',
    serverVersion: '0.0.0',
    notCaptured: [],
    untypedTypes: [],
    discoveryIncomplete: false,
    deviceTypes: [],
  },
});

/** A rename that fails once its target ends with `failOn` (set it after the setup install). */
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'wm-install-'));
  const fault = { failOn: undefined as string | undefined };
  const rename = ((from: string, to: string) => {
    if (fault.failOn !== undefined && to.endsWith(fault.failOn)) throw new Error('disk gone');
    renameSync(from, to);
  }) as typeof renameSync;
  const corrections = new FsPortTypeCorrections(dir, captureLogger());
  const installer = new FsCatalogInstaller(dir, corrections, rename);
  const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');
  const names = (rel = '4071') => readdirSync(join(dir, rel)).sort();
  return { dir, corrections, installer, read, names, fault };
}

const correction = {
  build: 4071,
  output: { type: 'Perlin', port: 'Output' },
  input: { type: 'Height Output', port: 'Input' },
  verdict: 'refused',
  source: 'apply_graph',
  at: 'x',
} as const;

describe('FsCatalogInstaller', () => {
  it('installs into an empty build folder', () => {
    const { installer, read, names } = setup();
    installer.install(entry(), 4071);
    expect(names()).toEqual(['capture.json', 'enum-options.json', 'port-types.json']);
    expect(JSON.parse(read('4071/port-types.json')).build).toBe(4071);
    expect(JSON.parse(read('4071/capture.json')).mode).toBe('full');
  });

  it('keeps the replaced catalog as previous', () => {
    const { installer, read } = setup();
    installer.install(entry(4071, ''), 4071);
    const firstEnums = read('4071/enum-options.json');
    installer.install(entry(4071, ' v2'), 4071);
    installer.install(entry(4071, ' v3'), 4071);
    expect(read('4071/port-types.json')).toContain('v3');
    expect(read('4071/port-types.previous.json')).toContain('v2');
    expect(read('4071/enum-options.previous.json')).toBe(firstEnums);
  });

  it('moves the corrections aside with a new port-type catalog', () => {
    const { corrections, installer, names } = setup();
    corrections.record(correction);
    installer.install(entry(), 4071);
    expect(names()).toContain('port-type-corrections.previous.json');
    expect(names()).not.toContain('port-type-corrections.json');
    expect(corrections.correctionsFor(4071)).toBeUndefined();
  });

  it('leaves the corrections alone for an enum-only install', () => {
    const { corrections, installer, names } = setup();
    corrections.record(correction);
    const { portTypes: _omit, ...enumOnly } = entry();
    installer.install(enumOnly, 4071);
    expect(names()).toContain('port-type-corrections.json');
    expect(corrections.correctionsFor(4071)).toBeDefined();
  });

  it('refuses a catalog of another build and changes nothing', () => {
    const { installer, names } = setup();
    installer.install(entry(), 4071);
    const before = names();
    expect(() => installer.install({ ...entry(), portTypes: portTypes(4069) }, 4071)).toThrow(
      /build 4069, but World Machine is build 4071/,
    );
    expect(() => installer.install(entry(4069), 4071)).toThrow(/build 4069, but World Machine is build 4071/);
    expect(names()).toEqual(before);
  });

  it('refuses a catalog the startup reader rejects and changes nothing', () => {
    const { dir, installer, names } = setup();
    mkdirSync(join(dir, '4071'));
    const bad = {
      ...entry(),
      portTypes: { ...portTypes(4071), outputClasses: 3 },
    } as unknown as CatalogInstall;
    expect(() => installer.install(bad, 4071)).toThrow(/outputClasses/);
    expect(names()).toEqual([]);
  });

  it('an install interrupted between renames keeps the old catalog and the corrections', () => {
    const { dir, corrections, installer, read, names, fault } = setup();
    installer.install(entry(4071, ''), 4071);
    const old = read('4071/port-types.json');
    corrections.record(correction);
    fault.failOn = '/port-types.json';
    expect(() => installer.install(entry(4071, ' v2'), 4071)).toThrow(/disk gone/);
    expect(read('4071/port-types.json')).toBe(old);
    expect(read('4071/port-types.previous.json')).toBe(old);
    expect(names()).toContain('port-type-corrections.json');
    expect(corrections.correctionsFor(4071)).toBeDefined();
    expect(names().filter((name) => name.endsWith('.tmp'))).toEqual([]);
    expect(names()).not.toContain('.install');
    const loaded = new FsLocalCatalogs(dir).load();
    expect(loaded.problems).toEqual([]);
    expect(loaded.portTypeCatalogs.map((c) => c.build)).toEqual([4071]);
  });

  it('a failure at the previous step leaves the live file and no temp link', () => {
    const { installer, read, names, fault } = setup();
    installer.install(entry(4071, ''), 4071);
    const old = read('4071/port-types.json');
    fault.failOn = '/port-types.previous.json';
    expect(() => installer.install(entry(4071, ' v2'), 4071)).toThrow(/disk gone/);
    expect(read('4071/port-types.json')).toBe(old);
    expect(names().filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('an interrupted first install leaves a loadable folder', () => {
    const { dir, installer, names, fault } = setup();
    fault.failOn = '/port-types.json';
    expect(() => installer.install(entry(), 4071)).toThrow(/disk gone/);
    expect(names()).toEqual(['enum-options.json']);
    const loaded = new FsLocalCatalogs(dir).load();
    expect(loaded.problems).toEqual([]);
    expect(loaded.enumCatalogs.map((c) => c.build)).toEqual([4071]);
    expect(loaded.portTypeCatalogs).toEqual([]);
  });

  it('says so when the corrections cannot be moved aside after the install', () => {
    const { dir, read } = setup();
    const stuck = new FsCatalogInstaller(dir, {
      retire: () => {
        throw new Error('locked');
      },
    });
    expect(() => stuck.install(entry(), 4071)).toThrow(
      /new catalog is installed.*corrections of build 4071 could not be moved aside.*locked/,
    );
    expect(read('4071/port-types.json')).toContain('Heightfield');
  });
});
