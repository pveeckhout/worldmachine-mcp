import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  parseEnumCapture,
  parseEnumCatalog,
} from '../../src/adapter/out/worldmachine/capture/enum-catalog.js';
import {
  ENUM_CATALOG_4067,
  ENUM_CATALOG_4069,
  ENUM_CATALOG_4070,
  ENUM_CATALOGS,
} from '../../src/adapter/out/worldmachine/enum-options.js';
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
// l.1556-1559: the rows of Combiner's `param list`, Method (enum) and Strength (float), in printed order.
const COMBINER_PARAMETERS = ['Method', 'Strength'];
// l.421-423 (a one-character name, `k`), l.6053-6058, and l.1782-1784: the rows of the other `param list`s below.
const VDM_PARAMETERS = ['type', 'k'];
const CLAMP_PARAMETERS = ['Range1', 'Range2', 'Type', 'Normalize', 'Soft Clipping'];
const COMPOSITE_PARAMETERS = ['Pack/Unpack', 'Type'];
// l.1523-1636: `device add Combiner`, its list row `#559   Combiner`, `device info #559` showing Scene View
// (l.1548-1554), `param list #559`, then Method's current value, range probe, and eleven set and get pairs.
const COMBINER = excerpt(1523, 1636);

// Build 4069 (2026-11-17) refuses an add word that matches several device types (wm-4069/raw/enum-options.txt l.966).
const raw4069 = (name: string) =>
  readFileSync(new URL(`../fixtures/wm-4069/raw/${name}`, import.meta.url), 'utf8');
const lines4069 = raw4069('enum-options.txt').split('\n');
const excerpt4069 = (first: number, last: number) => lines4069.slice(first - 1, last).join('\n');
const systemInfo4069 = raw4069('system-info.txt');
const BRIGHTNESS_REFUSAL =
  "Tag 'Brightness' matches multiple devices: Adjust Color, Bias/Gain, Gamma, Levels, Report Color, Select Color";

describe('parseEnumCapture refused add words (build 4069)', () => {
  it('skips an add refused as matching several devices, and reads the adds after it (wm-4069 l.965-1091)', () => {
    // l.989-1031: the capture's retry by name, `device add Bias/Gain` (no enum rows); l.1032-1091: Channel Combiner.
    const capture = parseEnumCapture(excerpt4069(965, 1091), systemInfo4069);
    expect(capture.refusedAdds).toEqual([{ word: 'Brightness', reason: BRIGHTNESS_REFUSAL }]);
    expect(capture.catalog).toEqual(parseEnumCatalog(excerpt4069(989, 1091), systemInfo4069));
    expect(Object.keys(capture.catalog.types)).toEqual(['Channel Combiner']);
  });

  it('still fails on an add refused for another reason', () => {
    // l.968-988 first: the device list World Machine shows after the refusal, so the add has a list to compare with.
    const other = `${excerpt4069(968, 988)}\n${excerpt4069(965, 1091)}`.replace(
      `Error: Error: ${BRIGHTNESS_REFUSAL}`,
      "Error: Error: Unknown device type 'Brightness'",
    );
    expect(() => parseEnumCapture(other, systemInfo4069)).toThrow(/device add Brightness: no new device/);
  });

  it('reports no refused adds for the build 4067 capture', () => {
    expect(parseEnumCapture(transcript, systemInfo).refusedAdds).toEqual([]);
  });
});

describe('parseEnumCatalog (enum-options design section 3)', () => {
  it('keys a type by its device list row, not by device info, and drops trailing whitespace (l.1523-1636)', () => {
    // l.1578 reads `#559.Method = Add ` with a trailing space.
    expect(parseEnumCatalog(COMBINER, systemInfo)).toEqual({
      build: 4067,
      types: { Combiner: { parameters: COMBINER_PARAMETERS, enums: { Method: COMBINER_METHOD } } },
    });
  });

  it('keys a type whose add word differs by the name it gets, through log lines (l.387-475)', () => {
    // `device add Anisotropy` adds 'VDM Features' (fact 81); l.449 and l.470-471 are log lines inside frames.
    expect(parseEnumCatalog(excerpt(387, 475), systemInfo).types).toEqual({
      'VDM Features': {
        parameters: VDM_PARAMETERS,
        enums: {
          type: ['Elevation', 'XY displacement', 'Relative area', 'Relative XY area', 'Twist', 'Anisotropy'],
        },
      },
    });
  });

  it('keys a type by the kind its device list row shows (l.6019-6087)', () => {
    // `device add Rescale` lists `#624   Rescale                  (Clamp)`.
    expect(parseEnumCatalog(excerpt(6019, 6087), systemInfo).types).toEqual({
      Clamp: { parameters: CLAMP_PARAMETERS, enums: { Type: ['Rescale', 'Clip', 'Expand'] } },
    });
  });

  it('records an enum whose range is (0--1) with no options (l.1748-1813, fact 86)', () => {
    expect(parseEnumCatalog(excerpt(1748, 1813), systemInfo).types).toEqual({
      'Composite Type': {
        parameters: COMPOSITE_PARAMETERS,
        enums: { 'Pack/Unpack': ['Pack to Composite Type', 'Unpack from Composite Type'], Type: [] },
      },
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

  it('prints the catalog of a capture with refused adds and names each refused word on stderr (build 4069)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'enum-catalog-'));
    try {
      const path = join(dir, 'enum-options.txt');
      copyFileSync(fileURLToPath(new URL('../fixtures/wm-4069/raw/enum-options.txt', import.meta.url)), path);
      copyFileSync(
        fileURLToPath(new URL('../fixtures/wm-4069/raw/system-info.txt', import.meta.url)),
        join(dir, 'system-info.txt'),
      );
      const result = spawnSync(process.execPath, [script, path], { encoding: 'utf8' });
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout).build).toBe(4069);
      expect(result.stderr.trim().split('\n')).toEqual([
        `skipped device add Brightness: ${BRIGHTNESS_REFUSAL}`,
        "skipped device add Fractal: Tag 'Fractal' matches multiple devices: Advanced Perlin, Basic Noise, Perlin Curve, VDM Noise, Voronoi",
        "skipped device add Rescale: Tag 'Rescale' matches multiple devices: Clamp, Levels, Scalar Clamp",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

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
    expect(ENUM_CATALOG_4067).toStrictEqual(parseEnumCatalog(transcript, systemInfo));
  });

  it('ships the build 4069 catalog its transcript parses to (parity)', () => {
    expect(ENUM_CATALOG_4069).toStrictEqual(parseEnumCatalog(raw4069('enum-options.txt'), systemInfo4069));
  });

  it('ships the build 4070 catalog its transcript parses to (parity)', () => {
    const raw4070 = (name: string) =>
      readFileSync(new URL(`../fixtures/wm-4070/raw/${name}`, import.meta.url), 'utf8');
    expect(ENUM_CATALOG_4070).toStrictEqual(
      parseEnumCatalog(raw4070('enum-options.txt'), raw4070('system-info.txt')),
    );
  });

  it('ships one catalog per build, 4067, 4069, and 4070', () => {
    expect(ENUM_CATALOGS.map((catalog) => catalog.build)).toEqual([4067, 4069, 4070]);
  });

  it('holds the 68 types and 111 enum parameters of fact 85', () => {
    expect(ENUM_CATALOG_4067.build).toBe(4067);
    expect(Object.keys(ENUM_CATALOG_4067.types)).toHaveLength(68);
    expect(Object.values(ENUM_CATALOG_4067.types).flatMap((entry) => Object.keys(entry.enums))).toHaveLength(
      111,
    );
    expect(ENUM_CATALOG_4067.types.Combiner?.enums.Method).toEqual(COMBINER_METHOD);
    expect(ENUM_CATALOG_4067.types.Combiner?.parameters).toEqual(COMBINER_PARAMETERS);
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
      expect(Object.keys(ENUM_CATALOG_4067.types[type]?.enums ?? {})).toEqual(enumNames);
      expect(ENUM_CATALOG_4067.types[type]?.parameters).toEqual(
        parseParamList(output).map((parameter) => parameter.name),
      );
      compared.add(type);
    }
    // The only blocks without a header are the five `Device '<name>' has no parameters.` lines (l.4097, l.4422,
    // l.4461, l.4500, l.5485), and every catalog type was compared, so nothing passed by being skipped.
    expect(withoutHeader).toBe(5);
    expect([...compared].sort()).toEqual(Object.keys(ENUM_CATALOG_4067.types).sort());
  });
});
