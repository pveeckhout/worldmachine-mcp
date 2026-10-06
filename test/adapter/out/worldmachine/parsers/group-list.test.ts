import { describe, expect, it } from 'vitest';
import { parseGroupList } from '../../../../../src/adapter/out/worldmachine/parsers/group-list.js';
import { codeOf, fixtureLines, rawFrame } from './fixture.js';

describe('parseGroupList', () => {
  it('reads groups, including names with punctuation and zero devices', () => {
    const groups = parseGroupList(fixtureLines('group-list.txt'));
    expect(groups).toHaveLength(5);
    expect(groups[0]).toEqual({ index: 0, name: 'Create your Terrain', deviceCount: 6 });
    expect(groups[3]).toEqual({ index: 3, name: 'Welcome to World Machine!', deviceCount: 0 });
  });

  it('reads an empty project (spec fact 21)', () => {
    expect(parseGroupList(['No groups in the current project.'])).toEqual([]);
  });

  it('fails on a count mismatch', () => {
    expect(codeOf(() => parseGroupList(['Groups (2 total):', '  [#0] A (1 device)']))).toBe(
      'UNEXPECTED_OUTPUT',
    );
  });

  it('reads the names exactly, without their padding (raw/v2b-groups.txt l.16-24, spec v2b fact 63)', () => {
    expect(parseGroupList(rawFrame('v2b-groups.txt', 'group list'))).toEqual([
      { index: 0, name: 'Create your Terrain', deviceCount: 6 },
      { index: 1, name: 'Export Basics', deviceCount: 4 },
      { index: 2, name: 'Texture & View', deviceCount: 5 },
      { index: 3, name: 'Welcome to World Machine!', deviceCount: 0 },
      { index: 4, name: 'Material Maps', deviceCount: 2 },
    ]);
  });

  it('keeps inner spaces and a name longer than the padding', () => {
    expect(
      parseGroupList([
        'Groups (2 total):',
        '  [#0] Two  spaces               (1 device)',
        `  [#1] ${'x'.repeat(30)} (3 devices)`,
      ]),
    ).toEqual([
      { index: 0, name: 'Two  spaces', deviceCount: 1 },
      { index: 1, name: 'x'.repeat(30), deviceCount: 3 },
    ]);
  });

  it('reads 12 rows whose one-digit indexes are padded to the width of two (final review F2, assumption B8)', () => {
    const names = Array.from({ length: 12 }, (_, index) => `Group ${index}`);
    const rows = names.map(
      (name, index) => `  [#${index}]${index < 10 ? '  ' : ' '}${name.padEnd(24)} (${index} devices)`,
    );
    expect(parseGroupList([`Groups (${names.length} total):`, ...rows])).toEqual(
      names.map((name, index) => ({ index, name, deviceCount: index })),
    );
  });

  it('reads a filtered list, whose header keeps the unfiltered total (l.25-28)', () => {
    expect(parseGroupList(rawFrame('v2b-groups.txt', 'group list Export'), true)).toEqual([
      { index: 1, name: 'Export Basics', deviceCount: 4 },
    ]);
  });

  it('reads a filter without a match as no groups (l.30-32, decision D2)', () => {
    expect(rawFrame('v2b-groups.txt', 'group list nomatch')).toEqual(['Groups (5 total):', '  (no matches)']);
    expect(parseGroupList(rawFrame('v2b-groups.txt', 'group list nomatch'), true)).toEqual([]);
  });

  it.each([
    ['a filtered list read as unfiltered', rawFrame('v2b-groups.txt', 'group list Export'), false],
    ['(no matches) without a filter', ['Groups (5 total):', '  (no matches)'], false],
    ['(no matches) next to a row', ['Groups (5 total):', '  [#1] A (1 device)', '  (no matches)'], true],
    ['indexes that do not start at 0', ['Groups (1 total):', '  [#1] A (1 device)'], false],
    ['indexes out of order', ['Groups (2 total):', '  [#1] A (1 device)', '  [#0] B (1 device)'], false],
    [
      'filtered indexes out of order',
      ['Groups (5 total):', '  [#3] A (1 device)', '  [#1] B (1 device)'],
      true,
    ],
    ['a filtered index beyond the total', ['Groups (2 total):', '  [#2] A (1 device)'], true],
    ['a row with other padding', ['Groups (1 total):', ' [#0] A (1 device)'], false],
    ['a row without its count', ['Groups (1 total):', '  [#0] A'], false],
    ['a row with trailing text', ['Groups (1 total):', '  [#0] A (1 device) x'], false],
    [
      'a blank line between rows',
      ['Groups (2 total):', '  [#0] A (1 device)', '', '  [#1] B (1 device)'],
      false,
    ],
    ['an indented header', ['  Groups (1 total):', '  [#0] A (1 device)'], false],
    // Spec fact 21 and fact 63: no groups is `No groups in the current project.`, and a filter without a match
    // prints `(no matches)`, so neither a count of 0 nor a filtered header without rows is a captured form.
    ['a header count of 0', ['Groups (0 total):'], false],
    ['a filtered list without rows', ['Groups (5 total):'], true],
  ])('fails on %s', (_label, output, filtered) => {
    expect(codeOf(() => parseGroupList(output, filtered))).toBe('UNEXPECTED_OUTPUT');
  });
});
