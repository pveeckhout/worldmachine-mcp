import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FsPortTypeCorrections } from '../../../../src/adapter/out/fs/fs-port-type-corrections.js';
import { type PortTypeCorrection, pairKey } from '../../../../src/domain/catalog.js';
import { captureLogger } from '../../../support/fake-wm.js';

const water = { type: 'Create Water', port: 'Water System' };
const output = { type: 'Height Output', port: 'Input' };
const refused: PortTypeCorrection = {
  build: 4069,
  output: water,
  input: output,
  verdict: 'refused',
  source: 'apply_graph',
  at: '2026-11-18T10:00:00.000Z',
};
const FILE = '4069/port-type-corrections.json';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'wm-corrections-'));
  const write = (rel: string, text: string) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  };
  const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');
  return { dir, write, read, logger: captureLogger() };
}

const fileWith = (entry: Record<string, unknown>, build = 4069) =>
  JSON.stringify({
    build,
    corrections: [
      {
        output: 'Create Water.Water System',
        input: 'Height Output.Input',
        verdict: 'refused',
        source: 'apply_graph',
        at: 'x',
        ...entry,
      },
    ],
  });

describe('FsPortTypeCorrections', () => {
  it('writes a correction and reads it back after a restart', () => {
    const { dir, logger } = setup();
    new FsPortTypeCorrections(dir, logger).record(refused);
    const again = new FsPortTypeCorrections(dir, logger);
    expect(again.correctionsFor(4069)?.get(pairKey(water, output))).toBe('refused');
    expect(again.problems()).toEqual([]);
  });

  it('the last verdict of a pair wins', () => {
    const { dir, logger, read } = setup();
    const store = new FsPortTypeCorrections(dir, logger);
    store.record(refused);
    store.record({ ...refused, verdict: 'accepted', source: 'connect_devices' });
    expect(store.correctionsFor(4069)?.get(pairKey(water, output))).toBe('accepted');
    expect(new FsPortTypeCorrections(dir, logger).correctionsFor(4069)?.get(pairKey(water, output))).toBe(
      'accepted',
    );
    expect(JSON.parse(read(FILE)).corrections).toHaveLength(2);
  });

  it('keeps builds apart and returns undefined for an unknown build', () => {
    const { dir, logger } = setup();
    const store = new FsPortTypeCorrections(dir, logger);
    store.record(refused);
    expect(store.correctionsFor(4067)).toBeUndefined();
  });

  it('round-trips a port name that contains dots', () => {
    const { dir, logger } = setup();
    const library = { type: 'Library Output', port: 'Add Output...' };
    new FsPortTypeCorrections(dir, logger).record({ ...refused, output: water, input: library });
    const again = new FsPortTypeCorrections(dir, logger);
    expect(again.problems()).toEqual([]);
    expect(again.correctionsFor(4069)?.get(pairKey(water, library))).toBe('refused');
  });

  it('loads a symlinked build folder at startup and keeps its entry through a record', () => {
    const { dir, logger, write, read } = setup();
    const other = { ...refused, output: { type: 'Create Water', port: 'Terrain' } };
    write('real/port-type-corrections.json', fileWith({}));
    symlinkSync(join(dir, 'real'), join(dir, '4069'));
    const store = new FsPortTypeCorrections(dir, logger);
    expect(store.problems()).toEqual([]);
    expect(store.correctionsFor(4069)?.get(pairKey(water, output))).toBe('refused');
    store.record(other);
    expect(JSON.parse(read(FILE)).corrections).toHaveLength(2);
  });

  it('keeps a file created after construction through the next record', () => {
    const { dir, logger, write, read } = setup();
    const store = new FsPortTypeCorrections(dir, logger);
    write(FILE, fileWith({}));
    store.record({ ...refused, output: { type: 'Create Water', port: 'Terrain' } });
    expect(JSON.parse(read(FILE)).corrections).toHaveLength(2);
    expect(store.correctionsFor(4069)?.get(pairKey(water, output))).toBe('refused');
  });

  it('refuses a record over a corrupt file created after construction', () => {
    const { dir, logger, write, read } = setup();
    const store = new FsPortTypeCorrections(dir, logger);
    write(FILE, '{');
    expect(() => store.record(refused)).toThrow(/were not loaded/);
    expect(read(FILE)).toBe('{');
  });

  it('reports a corrupt file and ignores it', () => {
    const { dir, logger, write } = setup();
    write(FILE, '{');
    const store = new FsPortTypeCorrections(dir, logger);
    expect(store.correctionsFor(4069)).toBeUndefined();
    expect(store.problems()).toEqual([expect.stringContaining('4069/port-type-corrections.json')]);
  });

  it.each([
    ['an input key with no dot', { input: 'Nodot' }],
    ['an unknown verdict', { verdict: 'maybe' }],
    ['an unknown source', { source: 'magic' }],
  ])('treats %s as a corrupt file', (_name, entry) => {
    const { dir, logger, write } = setup();
    write(FILE, fileWith(entry));
    const store = new FsPortTypeCorrections(dir, logger);
    expect(store.correctionsFor(4069)).toBeUndefined();
    expect(store.problems()).toHaveLength(1);
  });

  it('treats a file whose build differs from its folder as corrupt', () => {
    const { dir, logger, write } = setup();
    write(FILE, fileWith({}, 4067));
    const store = new FsPortTypeCorrections(dir, logger);
    expect(store.correctionsFor(4069)).toBeUndefined();
    expect(store.problems()).toHaveLength(1);
  });

  it('does not write over a corrections file that failed to load', () => {
    const { dir, logger, write, read } = setup();
    write(FILE, '{');
    expect(() => new FsPortTypeCorrections(dir, logger).record(refused)).toThrow(/were not loaded/);
    expect(read(FILE)).toBe('{');
  });

  it('leaves no temp file behind', () => {
    const { dir, logger } = setup();
    new FsPortTypeCorrections(dir, logger).record(refused);
    expect(readdirSync(join(dir, '4069'))).toEqual(['port-type-corrections.json']);
  });

  it('is fine with a missing directory, a build folder with no file, and non-canonical names', () => {
    const { dir, logger, write } = setup();
    write('4067/enum-options.json', '{}');
    write('04069/port-type-corrections.json', '{');
    expect(new FsPortTypeCorrections(join(dir, 'missing'), logger).problems()).toEqual([]);
    const store = new FsPortTypeCorrections(dir, logger);
    expect(store.problems()).toEqual([]);
    expect(store.correctionsFor(4067)).toBeUndefined();
  });

  it('logs each record at info', () => {
    const { dir, logger } = setup();
    new FsPortTypeCorrections(dir, logger).record(refused);
    expect(logger.lines).toContain(
      'info: port-type correction: build 4069, Create Water.Water System -> Height Output.Input refused (apply_graph)',
    );
  });

  it('does not overwrite a file whose second entry is bad', () => {
    const { dir, logger, write, read } = setup();
    const good = {
      output: 'Create Water.Water System',
      input: 'Height Output.Input',
      verdict: 'refused',
      source: 'apply_graph',
      at: 'x',
    };
    const text = JSON.stringify({ build: 4069, corrections: [good, { ...good, verdict: 'maybe' }] });
    write(FILE, text);
    const store = new FsPortTypeCorrections(dir, logger);
    expect(store.correctionsFor(4069)).toBeUndefined();
    expect(() => store.record(refused)).toThrow(/were not loaded/);
    expect(read(FILE)).toBe(text);
  });

  it.each([
    ['an empty type', { output: '.Port' }],
    ['an empty port', { input: 'Type.' }],
  ])('treats %s as a corrupt file', (_name, entry) => {
    const { dir, logger, write } = setup();
    write(FILE, fileWith(entry));
    expect(new FsPortTypeCorrections(dir, logger).problems()).toHaveLength(1);
  });

  describe('unreadable storage', () => {
    const restore: string[] = [];
    afterEach(() => {
      for (const path of restore.splice(0)) chmodSync(path, 0o700);
    });

    it('refuses every record when the directory cannot be listed', () => {
      const { dir, logger, write, read } = setup();
      write(FILE, '{"build":4069,"corrections":[]}');
      restore.push(dir);
      chmodSync(dir, 0o300);
      const store = new FsPortTypeCorrections(dir, logger);
      expect(store.problems()).toEqual([expect.stringContaining(dir)]);
      expect(() => store.record(refused)).toThrow(/were not loaded: .*fix or move/);
      chmodSync(dir, 0o700);
      expect(read(FILE)).toBe('{"build":4069,"corrections":[]}');
    });

    it('treats an unreadable corrections file as failed to load', () => {
      const { dir, logger, write, read } = setup();
      write(FILE, '{"build":4069,"corrections":[]}');
      restore.push(join(dir, FILE));
      chmodSync(join(dir, FILE), 0o000);
      const store = new FsPortTypeCorrections(dir, logger);
      expect(store.problems()).toEqual([expect.stringContaining('4069/port-type-corrections.json')]);
      expect(() => store.record(refused)).toThrow(/were not loaded/);
      chmodSync(join(dir, FILE), 0o600);
      expect(read(FILE)).toBe('{"build":4069,"corrections":[]}');
    });
  });

  describe('retire', () => {
    const PREVIOUS = '4069/port-type-corrections.previous.json';

    it('moves the file aside and forgets the build', () => {
      const { dir, logger, read } = setup();
      const store = new FsPortTypeCorrections(dir, logger);
      store.record(refused);
      store.retire(4069);
      expect(readdirSync(join(dir, '4069'))).toEqual(['port-type-corrections.previous.json']);
      expect(JSON.parse(read(PREVIOUS)).corrections).toHaveLength(1);
      expect(store.correctionsFor(4069)).toBeUndefined();
    });

    it('replaces an older previous file and is a no-op without a file', () => {
      const { dir, logger, write, read } = setup();
      write(PREVIOUS, 'old');
      const store = new FsPortTypeCorrections(dir, logger);
      expect(() => store.retire(4069)).not.toThrow();
      expect(read(PREVIOUS)).toBe('old');
      store.record(refused);
      store.retire(4069);
      expect(JSON.parse(read(PREVIOUS)).build).toBe(4069);
    });

    it('moves a corrupt file aside, clears its problem, and lets record work again', () => {
      const { dir, logger, write, read } = setup();
      write(FILE, '{');
      write('4070/port-type-corrections.json', '{');
      const store = new FsPortTypeCorrections(dir, logger);
      expect(store.problems()).toHaveLength(2);
      store.retire(4069);
      expect(read(PREVIOUS)).toBe('{');
      expect(store.problems()).toEqual([expect.stringContaining('4070/')]);
      store.record(refused);
      expect(JSON.parse(read(FILE)).corrections).toHaveLength(1);
      expect(() => store.record({ ...refused, build: 4070 })).toThrow(/were not loaded/);
    });
  });
});
