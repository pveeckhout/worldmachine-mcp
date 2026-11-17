import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FsLocalCatalogs } from '../../../../src/adapter/out/fs/fs-local-catalogs.js';
import { ENUM_CATALOG_4069 } from '../../../../src/adapter/out/worldmachine/enum-options.js';
import { PORT_TYPE_CATALOG_4069 } from '../../../../src/adapter/out/worldmachine/world-machine-port-types.js';

const newDir = (): string => mkdtempSync(join(tmpdir(), 'local-catalogs-'));
const put = (dir: string, build: string, file: string, content: string): void => {
  mkdirSync(join(dir, build), { recursive: true });
  writeFileSync(join(dir, build, file), content);
};

describe('FsLocalCatalogs', () => {
  it('reports nothing when the catalog folder is missing', () => {
    expect(new FsLocalCatalogs(join(newDir(), 'absent')).load()).toStrictEqual({
      enumCatalogs: [],
      portTypeCatalogs: [],
      problems: [],
    });
  });

  it('loads a build folder', () => {
    const dir = newDir();
    put(dir, '4071', 'port-types.json', JSON.stringify({ ...PORT_TYPE_CATALOG_4069, build: 4071 }));
    put(dir, '4071', 'enum-options.json', JSON.stringify({ ...ENUM_CATALOG_4069, build: 4071 }));
    const loaded = new FsLocalCatalogs(dir).load();
    expect(loaded.portTypeCatalogs.map((c) => c.build)).toEqual([4071]);
    expect(loaded.enumCatalogs.map((c) => c.build)).toEqual([4071]);
    expect(loaded.problems).toEqual([]);
  });

  it('skips a folder whose name is not all digits, and a missing file', () => {
    const dir = newDir();
    put(dir, 'notes', 'port-types.json', '{');
    put(dir, '4071', 'port-types.json', JSON.stringify({ ...PORT_TYPE_CATALOG_4069, build: 4071 }));
    const loaded = new FsLocalCatalogs(dir).load();
    expect(loaded.portTypeCatalogs).toHaveLength(1);
    expect(loaded.enumCatalogs).toEqual([]);
    expect(loaded.problems).toEqual([]);
  });

  it('rejects a catalog whose build differs from its folder', () => {
    const dir = newDir();
    put(dir, '4071', 'port-types.json', JSON.stringify(PORT_TYPE_CATALOG_4069));
    const loaded = new FsLocalCatalogs(dir).load();
    expect(loaded.portTypeCatalogs).toEqual([]);
    expect(loaded.problems).toEqual([
      expect.stringMatching(/4071\/port-types\.json: build 4069 in a folder for build 4071/),
    ]);
  });

  it('ignores a file that is not JSON and names it', () => {
    const dir = newDir();
    put(dir, '4071', 'enum-options.json', '{');
    const loaded = new FsLocalCatalogs(dir).load();
    expect(loaded.enumCatalogs).toEqual([]);
    expect(loaded.problems).toEqual([expect.stringMatching(/4071\/enum-options\.json: /)]);
  });

  it('ignores a file that fails validation and names it', () => {
    const dir = newDir();
    put(dir, '4071', 'port-types.json', JSON.stringify({ build: 4071 }));
    const loaded = new FsLocalCatalogs(dir).load();
    expect(loaded.portTypeCatalogs).toEqual([]);
    expect(loaded.problems).toEqual([expect.stringMatching(/4071\/port-types\.json: kind must be/)]);
  });
});
