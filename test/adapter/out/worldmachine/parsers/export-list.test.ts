import { describe, expect, it } from 'vitest';
import { parseExportList } from '../../../../../src/adapter/out/worldmachine/parsers/export-list.js';
import { codeOf, rawFrame } from './fixture.js';

const DEFAULT_TARGETS = [
  { device: 'Height Output', template: '<project> <name>-<res>.png' },
  { device: 'Material Output', template: '<project> <name> <res>.png' },
  { device: 'Colormap only', template: '<project> <name> <res>.png' },
  { device: 'Splatmap', template: '<project> <name> <res>.png' },
];

describe('parseExportList (fact 49)', () => {
  it('reads the default project (raw/v2-build-export.txt l.14-21)', () => {
    expect(parseExportList(rawFrame('v2-build-export.txt', 'export list'))).toEqual(DEFAULT_TARGETS);
  });

  it('reads an export list frame from which the process removed a late Build started. (raw/v2-build-isolate.txt l.146-154)', () => {
    expect(parseExportList(rawFrame('v2-build-isolate.txt', 'export list'))).toEqual(DEFAULT_TARGETS);
  });

  it('reads a name longer than the 20-character padding whole (assumption A3)', () => {
    expect(parseExportList(['Configured exports:', "  'Height Output for the coast' -> <name>.png"])).toEqual(
      [{ device: 'Height Output for the coast', template: '<name>.png' }],
    );
  });

  it('marks a row whose device name contains the arrow as ambiguous', () => {
    expect(parseExportList(['Configured exports:', "  'A' -> 'B' -> <name>.png"])).toEqual([
      { device: "A' -> 'B", template: '<name>.png', ambiguous: true },
    ]);
  });

  it('marks a row whose template contains the arrow as ambiguous', () => {
    expect(
      parseExportList(['Configured exports:', "  'Height Output       ' -> a' -> b/<name>.png"]),
    ).toEqual([{ device: "Height Output       ' -> a", template: 'b/<name>.png', ambiguous: true }]);
  });

  it('leaves a normal row without an ambiguous field', () => {
    const [target] = parseExportList(['Configured exports:', "  'Height Output       ' -> <name>.png"]);
    expect(target).toEqual({ device: 'Height Output', template: '<name>.png' });
    expect(target).not.toHaveProperty('ambiguous');
  });

  it('reads a header without rows as no outputs', () => {
    expect(parseExportList(['Configured exports:'])).toEqual([]);
  });

  it.each([
    ['a missing header', ["  'Height Output       ' -> <name>.png"]],
    ['a row without an arrow', ['Configured exports:', "  'Height Output       '"]],
    ['a row with an empty name', ['Configured exports:', "  '                    ' -> <name>.png"]],
  ])('fails on %s', (_label, output) => {
    expect(codeOf(() => parseExportList(output))).toBe('UNEXPECTED_OUTPUT');
  });
});
