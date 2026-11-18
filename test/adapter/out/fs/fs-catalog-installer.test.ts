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

function setup(rename?: typeof renameSync) {
  const dir = mkdtempSync(join(tmpdir(), 'wm-install-'));
  const corrections = new FsPortTypeCorrections(dir, captureLogger());
  const installer = new FsCatalogInstaller(dir, corrections, rename);
  const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');
  return { dir, corrections, installer, read };
}

describe('FsCatalogInstaller', () => {
  it('installs into an empty build folder', () => {
    const { dir, installer, read } = setup();
    installer.install(entry(), 4071);
    expect(readdirSync(join(dir, '4071')).sort()).toEqual([
      '.install',
      'capture.json',
      'enum-options.json',
      'port-types.json',
    ]);
    expect(JSON.parse(read('4071/port-types.json')).build).toBe(4071);
    expect(JSON.parse(read('4071/capture.json')).mode).toBe('full');
    expect(readdirSync(join(dir, '4071', '.install'))).toEqual([]);
  });

  it('keeps the replaced catalog as previous', () => {
    const { installer, read } = setup();
    installer.install(entry(4071, ''), 4071);
    const first = read('4071/port-types.json');
    const firstEnums = read('4071/enum-options.json');
    installer.install(entry(4071, ' v2'), 4071);
    installer.install(entry(4071, ' v3'), 4071);
    expect(read('4071/port-types.json')).toContain('v3');
    expect(read('4071/port-types.previous.json')).toContain('v2');
    expect(read('4071/port-types.previous.json')).not.toBe(first);
    expect(read('4071/enum-options.previous.json')).toBe(firstEnums);
  });

  it('moves the corrections aside with a new port-type catalog', () => {
    const { dir, corrections, installer } = setup();
    corrections.record({
      build: 4071,
      output: { type: 'Perlin', port: 'Output' },
      input: { type: 'Height Output', port: 'Input' },
      verdict: 'refused',
      source: 'apply_graph',
      at: 'x',
    });
    installer.install(entry(), 4071);
    const names = readdirSync(join(dir, '4071'));
    expect(names).toContain('port-type-corrections.previous.json');
    expect(names).not.toContain('port-type-corrections.json');
    expect(corrections.correctionsFor(4071)).toBeUndefined();
  });

  it('leaves the corrections alone for an enum-only install', () => {
    const { dir, corrections, installer } = setup();
    mkdirSync(join(dir, '4071'));
    writeFileSync(join(dir, '4071', 'port-type-corrections.json'), '{"build":4071,"corrections":[]}');
    const { portTypes: _omit, ...enumOnly } = entry();
    installer.install(enumOnly, 4071);
    expect(readdirSync(join(dir, '4071'))).toContain('port-type-corrections.json');
    expect(corrections).toBeDefined();
  });

  it('refuses a catalog of another build and changes nothing', () => {
    const { dir, installer } = setup();
    installer.install(entry(), 4071);
    const before = readdirSync(join(dir, '4071'));
    expect(() => installer.install({ ...entry(), portTypes: portTypes(4069) }, 4071)).toThrow(
      /build 4069, but World Machine is build 4071/,
    );
    expect(() => installer.install(entry(4069), 4071)).toThrow(/build 4069, but World Machine is build 4071/);
    expect(readdirSync(join(dir, '4071'))).toEqual(before);
  });

  it('refuses a catalog the startup reader rejects and changes nothing', () => {
    const { dir, installer } = setup();
    mkdirSync(join(dir, '4071'));
    const bad = {
      ...entry(),
      portTypes: { ...portTypes(4071), outputClasses: 3 },
    } as unknown as CatalogInstall;
    expect(() => installer.install(bad, 4071)).toThrow(/outputClasses/);
    expect(readdirSync(join(dir, '4071'))).toEqual([]);
  });

  it('an install interrupted between renames leaves a readable catalog', () => {
    let calls = 0;
    const failing = ((from: string, to: string) => {
      calls += 1;
      if (calls === 4) throw new Error('disk gone');
      renameSync(from, to);
    }) as typeof renameSync;
    const { dir, installer, read } = setup(failing);
    installer.install(entry(4071, ''), 4071);
    calls = 0;
    expect(() => installer.install(entry(4071, ' v2'), 4071)).toThrow(/disk gone/);
    const loaded = new FsLocalCatalogs(dir).load();
    expect(loaded.problems).toEqual([]);
    expect(loaded.portTypeCatalogs.map((c) => c.build)).toEqual([4071]);
    expect(read('4071/enum-options.json')).toBeDefined();
  });
});
