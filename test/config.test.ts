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
    });
  });

  it('has no allowed roots when the working directory is / or the home directory', () => {
    expect(loadConfig({}, '/', HOME).allowedRoots).toBeNull();
    expect(loadConfig({}, HOME, HOME).allowedRoots).toBeNull();
    expect(loadConfig({}, `${HOME}/`, HOME).allowedRoots).toBeNull();
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
  ])('rejects invalid %o', (env, name) => {
    expect(() => loadConfig(env, '/work', HOME)).toThrow(name);
  });
});
