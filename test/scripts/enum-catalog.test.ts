import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseEnumCatalog } from '../../scripts/enum-catalog.mjs';

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
      'a type the capture stopped on',
      () => `${COMBINER}\n>>> (type Combiner stopped)\nboom\n<<<`,
      /the capture did not complete/,
    ],
    ['a type captured twice', () => `${COMBINER}\n${COMBINER}`, /type 'Combiner' captured twice/],
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
