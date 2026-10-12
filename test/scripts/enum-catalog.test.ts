import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseEnumCatalog } from '../../scripts/enum-catalog.mjs';
import { ENUM_CATALOG } from '../../src/adapter/out/worldmachine/enum-options.js';
import { parseParamList } from '../../src/adapter/out/worldmachine/parsers/param-list.js';

const raw = (name: string) =>
  readFileSync(new URL(`../fixtures/wm-4067/raw/${name}`, import.meta.url), 'utf8');
const transcript = raw('enum-options.txt');
const systemInfo = raw('system-info.txt');
const lines = transcript.split('\n');

/** Lines `first` to `last` of raw/enum-options.txt, 1-based and inclusive, without the lines in `drop`. */
const excerpt = (first: number, last: number, drop: readonly number[] = []) =>
  lines
    .slice(first - 1, last)
    .filter((_, index) => !drop.includes(first + index))
    .join('\n');

// raw/enum-options.txt l.1572-1632 (fact 85).
const COMBINER_METHOD = [
  'Average',
  'Add',
  'Subtract',
  'Multiply',
  'Max',
  'Min',
  'Power',
  'Root',
  'Detail',
  'Differences',
  'Screen',
];
// l.1523-1636: `device add Combiner`, its list row `#559   Combiner`, `device info #559` showing Scene View
// (l.1548-1554), `param list #559`, then Method's current value, range probe, and eleven set and get pairs.
const COMBINER = excerpt(1523, 1636);

describe('parseEnumCatalog (enum-options design section 3)', () => {
  it('keys a type by its device list row, not by device info, and drops trailing whitespace (l.1523-1636)', () => {
    // l.1578 reads `#559.Method = Add ` with a trailing space.
    expect(parseEnumCatalog(COMBINER, systemInfo)).toEqual({
      build: 4067,
      types: { Combiner: { Method: COMBINER_METHOD } },
    });
  });

  it('keys a type whose add word differs by the name it gets, through log lines (l.387-475)', () => {
    // `device add Anisotropy` adds 'VDM Features' (fact 81); l.449 and l.470-471 are log lines inside frames.
    expect(parseEnumCatalog(excerpt(387, 475), systemInfo).types).toEqual({
      'VDM Features': {
        type: ['Elevation', 'XY displacement', 'Relative area', 'Relative XY area', 'Twist', 'Anisotropy'],
      },
    });
  });

  it('keys a type by the kind its device list row shows (l.6019-6087)', () => {
    // `device add Rescale` lists `#624   Rescale                  (Clamp)`.
    expect(parseEnumCatalog(excerpt(6019, 6087), systemInfo).types).toEqual({
      Clamp: { Type: ['Rescale', 'Clip', 'Expand'] },
    });
  });

  it('records an enum whose range is (0--1) with no options (l.1748-1813, fact 86)', () => {
    expect(parseEnumCatalog(excerpt(1748, 1813), systemInfo).types).toEqual({
      'Composite Type': { 'Pack/Unpack': ['Pack to Composite Type', 'Unpack from Composite Type'], Type: [] },
    });
  });

  it('omits a type without enum parameters (l.4388-4426)', () => {
    // l.4422: `Device 'Macro' has no parameters.`
    expect(parseEnumCatalog(excerpt(4388, 4426), systemInfo).types).toEqual({});
  });

  it('takes the build from the system info capture (raw/system-info.txt l.3)', () => {
    expect(parseEnumCatalog('', systemInfo)).toEqual({ build: 4067, types: {} });
  });

  it.each<[string, () => string, RegExp]>([
    [
      'a missing param get (l.1577-1579 dropped)',
      () => excerpt(1523, 1636, [1577, 1578, 1579]),
      /#559\.Method: no param get after index 1/,
    ],
    [
      'an unreadable label (l.1578 replaced)',
      () => COMBINER.replace('#559.Method = Add ', 'Add'),
      /no label for index 1/,
    ],
    [
      'a missing range error (l.1565-1567 dropped)',
      () => excerpt(1523, 1636, [1565, 1566, 1567]),
      /#559\.Method: no range error/,
    ],
    [
      'fewer labels than the range (l.1628-1633 dropped)',
      () => excerpt(1523, 1636, [1628, 1629, 1630, 1631, 1632, 1633]),
      /#559\.Method: 10 labels for range 0-10/,
    ],
    [
      'a param list of a device no list showed (from l.1548)',
      () => excerpt(1548, 1636),
      /#559: not in the device list/,
    ],
    [
      'a refused param set (l.1574 replaced)',
      () => COMBINER.replace('Set #559.Method = 1', 'Error: refused'),
      /type 'Combiner', parameter 'Method': param set to index 1 not confirmed/,
    ],
    [
      'a device add that shows no new device (l.1545 dropped after a list that had it)',
      () => `${excerpt(1526, 1547)}\n${excerpt(1523, 1636, [1545])}`,
      /device add Combiner: no new device in the device list/,
    ],
    [
      'a param list that names another device than the added one',
      () =>
        `${excerpt(1526, 1547, [1545])}\n${COMBINER.replace('>>> param list #559', '>>> param list #373')}`,
      /device add Combiner: param list #373 does not name a new device/,
    ],
    [
      'a type the capture stopped on',
      () => `${COMBINER}\n>>> (type Combiner stopped)\nboom\n<<<`,
      /the capture did not complete/,
    ],
    [
      'a type captured twice',
      () => `${COMBINER}\n${COMBINER.replaceAll('#559', '#560')}`,
      /type 'Combiner' captured twice/,
    ],
  ])('fails on %s', (_label, input, message) => {
    expect(() => parseEnumCatalog(input(), systemInfo)).toThrow(message);
  });

  // Ruling 1: the build comes only from the system info capture (raw/system-info.txt l.3).
  it.each<[string, string, RegExp]>([
    ['an empty capture', '', /expected one Version line, found 0/],
    ['no Version line', systemInfo.replace(/^.*Version:.*$/m, ''), /expected one Version line, found 0/],
    [
      'an unreadable build number',
      systemInfo.replace('Build 4067', 'Build ????'),
      /expected one Version line, found 0/,
    ],
    [
      'two Version lines',
      `${systemInfo}  Version:  Build 4068 'Other'\n`,
      /expected one Version line, found 2/,
    ],
  ])('fails on a system info with %s', (_label, info, message) => {
    expect(() => parseEnumCatalog(COMBINER, info)).toThrow(message);
  });
});

const script = fileURLToPath(new URL('../../scripts/build-enum-catalog.mjs', import.meta.url));
const transcriptPath = fileURLToPath(new URL('../fixtures/wm-4067/raw/enum-options.txt', import.meta.url));

describe('scripts/build-enum-catalog.mjs (enum-options design section 3)', () => {
  it('prints the catalog the transcript and its system info parse to', () => {
    const result = spawnSync(process.execPath, [script, transcriptPath], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toStrictEqual(parseEnumCatalog(transcript, systemInfo));
  });

  it('exits 2 with a usage line when no transcript is given', () => {
    const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('usage: node scripts/build-enum-catalog.mjs <transcript>');
  });

  /** Runs the script on a copy of the transcript in a fresh directory, beside `systemInfoText` if given (ruling 1). */
  function generateBeside(systemInfoText?: string) {
    const dir = mkdtempSync(join(tmpdir(), 'enum-catalog-'));
    try {
      copyFileSync(transcriptPath, join(dir, 'enum-options.txt'));
      if (systemInfoText !== undefined) writeFileSync(join(dir, 'system-info.txt'), systemInfoText);
      return spawnSync(process.execPath, [script, join(dir, 'enum-options.txt')], { encoding: 'utf8' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('fails when no system-info.txt lies beside the transcript', () => {
    const result = generateBeside();
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('system-info.txt');
  });

  it('fails when the system-info.txt beside the transcript has no readable build', () => {
    const result = generateBeside(systemInfo.replace('Build 4067', 'Build ????'));
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('expected one Version line, found 0');
  });
});

describe('the shipped enum catalog (enum-options design section 3)', () => {
  it('is exactly what raw/enum-options.txt parses to (parity)', () => {
    expect(ENUM_CATALOG).toStrictEqual(parseEnumCatalog(transcript, systemInfo));
  });

  it('holds the 68 types and 111 enum parameters of fact 85', () => {
    expect(ENUM_CATALOG.build).toBe(4067);
    expect(Object.keys(ENUM_CATALOG.types)).toHaveLength(68);
    expect(Object.values(ENUM_CATALOG.types).flatMap((entry) => Object.keys(entry))).toHaveLength(111);
    expect(ENUM_CATALOG.types.Combiner?.Method).toEqual(COMBINER_METHOD);
  });

  it("agrees with the adapter's parseParamList on the enum rows of every captured param list", () => {
    // Guards the regexes copied into scripts/enum-catalog.mjs against drifting from parsers/param-list.ts.
    // A block's type is the kind in its header, which equals the device list kind: l.1545 `#559   Combiner` and
    // l.1557 `Parameters for 'Combiner' (Combiner):`.
    const blocks = transcript
      .split('>>> param list #')
      .slice(1)
      .map((block) => block.split('\n<<<')[0]?.split('\n').slice(1) ?? []);
    const compared = new Set<string>();
    let withoutHeader = 0;
    for (const block of blocks) {
      const output = block.filter((line) => !/^\[[A-Za-z]+\s*\] /.test(line));
      const type = /^Parameters for '.*' \((.*)\):$/.exec(output[0] ?? '')?.[1];
      if (type === undefined) {
        withoutHeader += 1;
        continue;
      }
      const enumNames = parseParamList(output)
        .filter((parameter) => parameter.type === 'enum')
        .map((parameter) => parameter.name);
      if (enumNames.length === 0) continue;
      expect(Object.keys(ENUM_CATALOG.types[type] ?? {})).toEqual(enumNames);
      compared.add(type);
    }
    // The only blocks without a header are the five `Device '<name>' has no parameters.` lines (l.4097, l.4422,
    // l.4461, l.4500, l.5485), and every catalog type was compared, so nothing passed by being skipped.
    expect(withoutHeader).toBe(5);
    expect([...compared].sort()).toEqual(Object.keys(ENUM_CATALOG.types).sort());
  });
});
