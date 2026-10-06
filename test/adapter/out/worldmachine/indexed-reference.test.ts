import { describe, expect, it } from 'vitest';
import {
  type IndexedKind,
  resolveIndexed,
} from '../../../../src/adapter/out/worldmachine/indexed-reference.js';

const EXACT: IndexedKind = {
  what: 'snapshot',
  listTool: 'list_snapshots',
  sameName: (listed, wanted) => listed === wanted,
};
const ANY_CASE: IndexedKind = {
  what: 'group',
  listTool: 'list_groups',
  sameName: (listed, wanted) => listed.toLowerCase() === wanted.toLowerCase(),
};
// raw/v2b-snapshots.txt l.92-98.
const ITEMS = [
  { index: 0, name: 'A' },
  { index: 1, name: 'B with space' },
  { index: 2, name: 'A' },
  { index: 3, name: 'n'.repeat(40) },
];

function refusal(action: () => unknown): { code?: string; message?: string } {
  try {
    action();
  } catch (error) {
    return error as { code?: string; message?: string };
  }
  throw new Error('expected a refusal');
}

describe('resolveIndexed (spec v2b section 4)', () => {
  it('resolves #<n> to the listed item with that index', () => {
    expect(resolveIndexed(ITEMS, '#2', EXACT)).toEqual({ index: 2, name: 'A' });
    expect(resolveIndexed(ITEMS, '#01', EXACT)).toEqual({ index: 1, name: 'B with space' });
  });

  it('resolves a name that exactly one item has', () => {
    expect(resolveIndexed(ITEMS, 'B with space', EXACT)).toEqual({ index: 1, name: 'B with space' });
    expect(resolveIndexed(ITEMS, 'b WITH space', ANY_CASE)).toEqual({ index: 1, name: 'B with space' });
  });

  it('refuses a name several items have, naming their indexes', () => {
    expect(refusal(() => resolveIndexed(ITEMS, 'A', EXACT))).toMatchObject({
      code: 'REFUSED',
      message: "The snapshot name 'A' matches #0, #2; use #<index>",
    });
    expect(refusal(() => resolveIndexed(ITEMS, 'a', ANY_CASE))).toMatchObject({
      code: 'REFUSED',
      message: "The group name 'a' matches #0, #2; use #<index>",
    });
  });

  it.each([
    ['another case, compared exactly', 'b with space'],
    ['a leading space', ' B with space'],
    ['a trailing space', 'B with space '],
    ['a missing name', 'missing'],
    ['a malformed index', '#x'],
  ])('refuses %s', (_label, reference) => {
    expect(refusal(() => resolveIndexed(ITEMS, reference, EXACT))).toMatchObject({
      code: 'REFUSED',
      message: `No snapshot '${reference}' in the current project; see list_snapshots`,
    });
  });

  it('refuses an index that is not in the list, and any reference into an empty list', () => {
    expect(refusal(() => resolveIndexed(ITEMS, '#4', EXACT))).toMatchObject({
      code: 'REFUSED',
      message: 'No snapshot #4 in the current project; see list_snapshots',
    });
    expect(refusal(() => resolveIndexed([], '#0', ANY_CASE))).toMatchObject({
      code: 'REFUSED',
      message: 'No group #0 in the current project; see list_groups',
    });
  });

  it('refuses #<n> when an item at another index has that name, naming both indexes (final review F3)', () => {
    const items = [...ITEMS, { index: 4, name: '#1' }];
    expect(refusal(() => resolveIndexed(items, '#1', EXACT))).toMatchObject({
      code: 'REFUSED',
      message:
        "'#1' is both an index and the name of #4; use the other item's index or rename it in the window",
    });
    expect(refusal(() => resolveIndexed(items, '#1', ANY_CASE))).toMatchObject({ code: 'REFUSED' });
  });

  it('resolves #<n> when only the item at that index has that name', () => {
    expect(
      resolveIndexed(
        [
          { index: 0, name: 'A' },
          { index: 1, name: '#1' },
        ],
        '#1',
        EXACT,
      ),
    ).toEqual({
      index: 1,
      name: '#1',
    });
  });

  it("compares the shadowing name with the caller's name comparison", () => {
    const items = [...ITEMS, { index: 4, name: '#01' }];
    expect(resolveIndexed(items, '#1', EXACT)).toEqual({ index: 1, name: 'B with space' });
    const noLeadingZeros: IndexedKind = {
      ...EXACT,
      sameName: (listed, wanted) => listed.replace(/^#0+/, '#') === wanted,
    };
    expect(refusal(() => resolveIndexed(items, '#1', noLeadingZeros))).toMatchObject({
      code: 'REFUSED',
      message:
        "'#1' is both an index and the name of #4; use the other item's index or rename it in the window",
    });
  });
});
