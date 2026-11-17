import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const HOME = '/home/user';

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig({}, '/work/terrain', HOME)).toEqual({
      bin: null,
      allowedRoots: ['/work/terrain'],
      defaultProject: undefined,
      logLevel: 'info',
      commandTimeoutMs: 15_000,
      idleTimeoutMs: 900_000,
      catalogDir: expect.any(String),
    });
  });

  it('reads every variable', () => {
    const config = loadConfig(
      {
        WORLD_MACHINE_BIN: '/opt/wm/wm',
        WORLD_MACHINE_ALLOWED_ROOTS: ['/a', '/b'].join(path.delimiter),
        WORLD_MACHINE_DEFAULT_PROJECT: '/a/x.tmd',
        WORLD_MACHINE_LOG_LEVEL: 'DEBUG',
        WORLD_MACHINE_COMMAND_TIMEOUT_MS: '5000',
        WORLD_MACHINE_IDLE_TIMEOUT_MS: '0',
      },
      '/work',
      HOME,
    );
    expect(config).toEqual({
      bin: '/opt/wm/wm',
      allowedRoots: ['/a', '/b'],
      defaultProject: '/a/x.tmd',
      logLevel: 'debug',
      commandTimeoutMs: 5000,
      idleTimeoutMs: 0,
      catalogDir: expect.any(String),
    });
  });

  it('has no allowed roots when the working directory is / or the home directory', () => {
    expect(loadConfig({}, '/', HOME).allowedRoots).toBeNull();
    expect(loadConfig({}, HOME, HOME).allowedRoots).toBeNull();
    expect(loadConfig({}, `${HOME}/`, HOME).allowedRoots).toBeNull();
  });

  it('resolves relative allowed roots against the given working directory', () => {
    const config = loadConfig({ WORLD_MACHINE_ALLOWED_ROOTS: `terrain${path.delimiter}/abs` }, '/work', HOME);
    expect(config.allowedRoots).toEqual(['/work/terrain', '/abs']);
  });

  it('treats blank values as unset', () => {
    const config = loadConfig({ WORLD_MACHINE_BIN: '  ', WORLD_MACHINE_ALLOWED_ROOTS: '' }, '/work', HOME);
    expect(config.bin).toBeNull();
    expect(config.allowedRoots).toEqual(['/work']);
  });

  it.each([
    [{ WORLD_MACHINE_LOG_LEVEL: 'loud' }, 'WORLD_MACHINE_LOG_LEVEL'],
    [{ WORLD_MACHINE_COMMAND_TIMEOUT_MS: '0' }, 'WORLD_MACHINE_COMMAND_TIMEOUT_MS'],
    [{ WORLD_MACHINE_COMMAND_TIMEOUT_MS: '1.5' }, 'WORLD_MACHINE_COMMAND_TIMEOUT_MS'],
    [{ WORLD_MACHINE_IDLE_TIMEOUT_MS: '-1' }, 'WORLD_MACHINE_IDLE_TIMEOUT_MS'],
    [{ WORLD_MACHINE_COMMAND_TIMEOUT_MS: '2147483648' }, 'WORLD_MACHINE_COMMAND_TIMEOUT_MS'],
    [{ WORLD_MACHINE_IDLE_TIMEOUT_MS: '2147483648' }, 'WORLD_MACHINE_IDLE_TIMEOUT_MS'],
    [{ WORLD_MACHINE_COMMAND_TIMEOUT_MS: '9'.repeat(400) }, 'WORLD_MACHINE_COMMAND_TIMEOUT_MS'],
    [{ WORLD_MACHINE_IDLE_TIMEOUT_MS: '9'.repeat(400) }, 'WORLD_MACHINE_IDLE_TIMEOUT_MS'],
  ])('rejects invalid %o', (env, name) => {
    expect(() => loadConfig(env, '/work', HOME)).toThrow(name);
  });

  it('accepts the largest timer value for both timeouts', () => {
    const config = loadConfig(
      { WORLD_MACHINE_COMMAND_TIMEOUT_MS: '2147483647', WORLD_MACHINE_IDLE_TIMEOUT_MS: '2147483647' },
      '/work',
      HOME,
    );
    expect(config.commandTimeoutMs).toBe(2_147_483_647);
    expect(config.idleTimeoutMs).toBe(2_147_483_647);
  });

  describe('catalogDir', () => {
    it('puts catalogs under XDG_CONFIG_HOME', () => {
      expect(loadConfig({ XDG_CONFIG_HOME: '/x' }, '/w', '/h', 'linux').catalogDir).toBe(
        '/x/worldmachine-mcp/catalogs',
      );
    });

    it('ignores a blank or relative XDG_CONFIG_HOME', () => {
      expect(loadConfig({ XDG_CONFIG_HOME: ' ' }, '/w', '/h', 'linux').catalogDir).toBe(
        '/h/.config/worldmachine-mcp/catalogs',
      );
      expect(loadConfig({ XDG_CONFIG_HOME: 'rel' }, '/w', '/h', 'linux').catalogDir).toBe(
        '/h/.config/worldmachine-mcp/catalogs',
      );
    });

    it('falls back to ~/.config', () => {
      expect(loadConfig({}, '/w', '/h', 'linux').catalogDir).toBe('/h/.config/worldmachine-mcp/catalogs');
    });

    it('uses Application Support on macOS', () => {
      expect(loadConfig({}, '/w', '/h', 'darwin').catalogDir).toBe(
        '/h/Library/Application Support/worldmachine-mcp/catalogs',
      );
    });

    it('uses APPDATA on Windows', () => {
      expect(loadConfig({ APPDATA: '/a' }, '/w', '/h', 'win32').catalogDir).toBe(
        path.join('/a', 'worldmachine-mcp', 'catalogs'),
      );
      expect(loadConfig({}, '/w', '/h', 'win32').catalogDir).toBe(
        path.join('/h', 'AppData', 'Roaming', 'worldmachine-mcp', 'catalogs'),
      );
    });

    it('honours WORLD_MACHINE_CATALOG_DIR, relative to the working directory', () => {
      expect(loadConfig({ WORLD_MACHINE_CATALOG_DIR: 'cat' }, '/w', '/h', 'linux').catalogDir).toBe('/w/cat');
    });
  });
});
