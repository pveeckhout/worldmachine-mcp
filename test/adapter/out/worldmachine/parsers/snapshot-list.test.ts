import { describe, expect, it } from 'vitest';
import { parseSnapshotList } from '../../../../../src/adapter/out/worldmachine/parsers/snapshot-list.js';
import { codeOf, rawFrame } from './fixture.js';

const A = { index: 0, name: 'A', created: '2026-10-06 11:09' };

describe('parseSnapshotList (spec v2b fact 57)', () => {
  it('reads a project without snapshots, by either command name (raw/v2b-snapshots.txt l.20-25)', () => {
    expect(parseSnapshotList(rawFrame('v2b-snapshots.txt', 'snapshot list'))).toEqual([]);
    expect(parseSnapshotList(rawFrame('v2b-snapshots.txt', 'snapshots'))).toEqual([]);
  });

  it('reads one snapshot (l.29-32)', () => {
    expect(parseSnapshotList(rawFrame('v2b-snapshots.txt', 'snapshot list', 1))).toEqual([A]);
  });

  it('reads names with spaces, a repeated name, and a 40-character name in creation order (l.92-98)', () => {
    expect(parseSnapshotList(rawFrame('v2b-snapshots.txt', 'snapshot list', 3))).toEqual([
      A,
      { index: 1, name: 'B with space', created: '2026-10-06 11:09' },
      { index: 2, name: 'A', created: '2026-10-06 11:09' },
      { index: 3, name: 'n'.repeat(40), created: '2026-10-06 11:09' },
    ]);
  });

  it('reads the list after a delete with the indexes shifted down (l.236-241)', () => {
    expect(parseSnapshotList(rawFrame('v2b-snapshots.txt', 'snapshot list', 7))).toEqual([
      A,
      { index: 1, name: 'A', created: '2026-10-06 11:09' },
      { index: 2, name: 'n'.repeat(40), created: '2026-10-06 11:09' },
    ]);
  });

  it('reads the snapshots kept after a restore (raw/v2b-snapshot-restore.txt l.77-81)', () => {
    expect(parseSnapshotList(rawFrame('v2b-snapshot-restore.txt', 'snapshot list'))).toEqual([
      { index: 0, name: 'S0', created: '2026-10-06 11:10' },
      { index: 1, name: 'S1', created: '2026-10-06 11:10' },
    ]);
  });

  it('accepts the blank line that ends the list', () => {
    expect(parseSnapshotList(['Snapshots (1 total):', "  [#0] 'A' - 2026-10-06 11:09", ''])).toEqual([A]);
  });

  it.each([
    ['a header count above the rows', ['Snapshots (2 total):', "  [#0] 'A' - 2026-10-06 11:09"]],
    ['a header count below the rows', ['Snapshots (0 total):', "  [#0] 'A' - 2026-10-06 11:09"]],
    ['indexes that do not start at 0', ['Snapshots (1 total):', "  [#1] 'A' - 2026-10-06 11:09"]],
    [
      'indexes out of order',
      ['Snapshots (2 total):', "  [#1] 'A' - 2026-10-06 11:09", "  [#0] 'B' - 2026-10-06 11:09"],
    ],
    ['a row without quotes', ['Snapshots (1 total):', '  [#0] A - 2026-10-06 11:09']],
    ['a row with an empty name', ['Snapshots (1 total):', "  [#0] '' - 2026-10-06 11:09"]],
    ['a time in another format', ['Snapshots (1 total):', "  [#0] 'A' - 06.10.2026 11:09"]],
    ['a row with other padding', ['Snapshots (1 total):', " [#0] 'A' - 2026-10-06 11:09"]],
    ['a row with trailing text', ['Snapshots (1 total):', "  [#0] 'A' - 2026-10-06 11:09 x"]],
    [
      'a blank line between rows',
      ['Snapshots (2 total):', "  [#0] 'A' - 2026-10-06 11:09", '', "  [#1] 'B' - 2026-10-06 11:09"],
    ],
    ['another header', ['Snapshot list (1 total):', "  [#0] 'A' - 2026-10-06 11:09"]],
    ['no output', []],
    ['an indented empty answer', ['  No snapshots.']],
    // Fact 57: an empty project prints `No snapshots.`, never a header with a count of 0.
    ['a header count of 0', ['Snapshots (0 total):']],
  ])('fails on %s', (_label, output) => {
    expect(codeOf(() => parseSnapshotList(output))).toBe('UNEXPECTED_OUTPUT');
  });
});
