import type { Snapshot } from '../../../../domain/snapshot.js';
import { withoutTrailingBlanks } from './lines.js';
import { unexpectedOutput } from './unexpected.js';

// Spec v2b fact 57 (raw/v2b-snapshots.txt l.20-32): an empty answer, or a header, one row per snapshot, and a blank
// line. Rows are two spaces, `[#<index>]`, a space, the name in single quotes, ` - `, and the creation time. Assumption
// B8: lists of 10 or more were not captured, so one or more spaces after `[#<index>]` are accepted in case World
// Machine aligns the column; the quotes still delimit the name exactly.
const EMPTY = 'No snapshots.';
const HEADER = /^Snapshots \((\d+) total\):$/;
const ROW = /^ {2}\[#(\d+)\] +'(.+)' - (\d{4}-\d{2}-\d{2} \d{2}:\d{2})$/;

/** Indexes must run 0 to n-1 and match the header count (spec v2b section 5); anything else is UNEXPECTED_OUTPUT. */
export function parseSnapshotList(output: readonly string[]): Snapshot[] {
  const lines = withoutTrailingBlanks(output);
  if (lines.length === 1 && lines[0] === EMPTY) return [];
  const [header, ...rows] = lines;
  const count = HEADER.exec(header ?? '');
  // Fact 57: no snapshots is `No snapshots.`, so a header with a count of 0 is not a form World Machine prints.
  if (!count || count[1] === '0') throw unexpectedOutput('snapshot list', output);
  const snapshots = rows.map((row, position): Snapshot => {
    const match = ROW.exec(row);
    if (!match || Number(match[1]) !== position || match[2] === undefined || match[3] === undefined) {
      throw unexpectedOutput('snapshot list', output);
    }
    return { index: position, name: match[2], created: match[3] };
  });
  if (snapshots.length !== Number(count[1])) throw unexpectedOutput('snapshot list', output);
  return snapshots;
}
