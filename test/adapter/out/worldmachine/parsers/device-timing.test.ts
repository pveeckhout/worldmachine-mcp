import { describe, expect, it } from 'vitest';
import { isBuiltAtResolution } from '../../../../../src/adapter/out/worldmachine/parsers/device-timing.js';
import { codeOf, rawFrame } from './fixture.js';

const timing = (device: number, occurrence = 0) =>
  rawFrame('build-not-built-timing.txt', `debug devicetiming #${device}`, occurrence);
// raw/build-not-built-timing.txt l.79-82: the column header, the no-results line, and the legend.
const [, COLUMNS = '', NONE = '', LEGEND = ''] = timing(2);
const title = (name: string, id: number) => `Build timing for '${name}' (#${id}), per result level:`;

describe('isBuiltAtResolution (fact 93)', () => {
  it('reads no finished results for the File Output and the River (raw/build-not-built-timing.txt l.72-82)', () => {
    expect(isBuiltAtResolution(3, timing(3), 513)).toBe(false);
    expect(isBuiltAtResolution(2, timing(2), 513)).toBe(false);
  });

  it('reads the result rows of the Gradient that fed the River (l.84-90)', () => {
    expect(isBuiltAtResolution(1, timing(1), 513)).toBe(true);
  });

  it('reads the result rows of both devices of Gradient into File Output (l.167-181)', () => {
    expect(isBuiltAtResolution(2, timing(2, 1), 513)).toBe(true);
    expect(isBuiltAtResolution(1, timing(1, 1), 513)).toBe(true);
  });

  // Fact 95 (raw/build-stop-timing.txt l.190-196, l.187-189): a stopped build leaves lower levels only, or nothing.
  it('reads a table with lower levels only as not built (fact 95)', () => {
    const stopped = rawFrame('build-stop-timing.txt', 'debug devicetiming #2', 3);
    expect(stopped.slice(2, 4)).toEqual([expect.stringMatching(/^129px/), expect.stringMatching(/^257px/)]);
    expect(isBuiltAtResolution(2, stopped, 2049)).toBe(false);
    expect(isBuiltAtResolution(1, timing(1), 1025)).toBe(false);
  });

  it('reads a table with the scene resolution row as built, and the same table as not built at a higher one', () => {
    expect(isBuiltAtResolution(1, timing(1), 513)).toBe(true);
    expect(isBuiltAtResolution(1, timing(1), 2049)).toBe(false);
  });

  it('reads the third answer, the device has no build results yet, as not built (fact 95, l.187-189)', () => {
    const none = rawFrame('build-stop-timing.txt', 'debug devicetiming #1');
    expect(none).toEqual(["'Height Output' has no build results yet."]);
    expect(isBuiltAtResolution(1, none, 2049)).toBe(false);
  });

  it('reads the id from the end of a title whose name holds a quote and an id (Review Focus 5)', () => {
    expect(isBuiltAtResolution(5, [title("It's (#2)", 5), COLUMNS, NONE, LEGEND], 513)).toBe(false);
  });

  it.each([
    [
      'the summary of every device (l.64-70)',
      1,
      rawFrame('build-not-built-timing.txt', 'debug devicetiming'),
    ],
    ['the frame of another device', 3, timing(2)],
    ['an empty output', 1, []],
    ['a frame without its legend', 2, timing(2).slice(0, -1)],
    ['the third answer with text after it', 1, ["'Height Output' has no build results yet.", 'more']],
    ['the third answer without its quotes', 1, ['Height Output has no build results yet.']],
    ['the third answer beside a table', 1, [...timing(1), "'Gradient' has no build results yet."]],
    ['a frame without rows', 2, [title('River', 2), COLUMNS, LEGEND]],
    [
      'a summary row in a device frame',
      1,
      [title('Gradient', 1), COLUMNS, timing(1)[2]?.replace('129px', 'Gradient') ?? '', LEGEND],
    ],
    [
      'result rows beside the no-results line',
      1,
      [title('Gradient', 1), COLUMNS, NONE, timing(1)[2] ?? '', LEGEND],
    ],
    // Plan decision B11 (Codex round 1, ruling 1): only captured time tokens, `<n>ms`.
    [
      'a row whose times are not times',
      1,
      [title('Gradient', 1), COLUMNS, '129px error error error error', LEGEND],
    ],
    [
      'a row with a time in seconds',
      1,
      [title('Gradient', 1), COLUMNS, `${'129px'.padEnd(37)}1.2s      1ms       0ms       1ms`, LEGEND],
    ],
    ['another legend', 1, [title('Gradient', 1), COLUMNS, timing(1)[2] ?? '', 'Prepare = something else']],
    // Codex round 2, ruling 1: a blank line inside the table is not skipped.
    [
      'a blank row inside the table',
      1,
      [title('Gradient', 1), COLUMNS, timing(1)[2] ?? '', '', timing(1)[3] ?? '', LEGEND],
    ],
  ])('fails UNEXPECTED_OUTPUT on %s', (_label, id, output) => {
    expect(codeOf(() => isBuiltAtResolution(id, output, 513))).toBe('UNEXPECTED_OUTPUT');
  });
});
