import type { Group } from '../../../../domain/group.js';
import { withoutTrailingBlanks } from './lines.js';
import { unexpectedOutput } from './unexpected.js';

// Spec v1 fact 21: a project without groups.
const EMPTY = 'No groups in the current project.';
const HEADER = /^Groups \((\d+) total\):$/;
// Spec v2b fact 63 (raw/v2b-groups.txt l.16-24): two spaces, `[#<index>]`, a space, the name padded with spaces (a
// longer name is printed whole and followed by one space), a space, and the device count. The name keeps everything
// but the padding, so a name's own trailing spaces are lost; group references compare names the same way (spec v2b
// section 4). Assumption B8: lists of 10 or more were not captured, so one or more spaces after `[#<index>]` are
// accepted in case World Machine aligns the column; a name therefore also loses any leading spaces.
const ROW = /^ {2}\[#(\d+)\] +(.+?) +\((\d+) devices?\)$/;
// Decision D2 (raw/v2b-groups.txt l.30-32): a filter without a match prints the header and this line.
const NO_MATCHES = '  (no matches)';

/**
 * `filtered`: the list of `group list <filter>`, whose header keeps the unfiltered total (fact 63). Indexes run 0 to
 * n-1 without a filter and rise below the total with one (decision D3); anything else is UNEXPECTED_OUTPUT.
 */
export function parseGroupList(output: readonly string[], filtered = false): Group[] {
  const lines = withoutTrailingBlanks(output);
  if (lines.length === 1 && lines[0] === EMPTY) return [];
  const [header, ...rows] = lines;
  const count = HEADER.exec(header ?? '');
  if (!count) throw unexpectedOutput('group list', output);
  const total = Number(count[1]);
  if (filtered && rows.length === 1 && rows[0] === NO_MATCHES) return [];
  if (total === 0 || rows.length === 0) throw unexpectedOutput('group list', output);
  const groups = rows.map((row): Group => {
    const match = ROW.exec(row);
    if (!match || match[2] === undefined) throw unexpectedOutput('group list', output);
    return { index: Number(match[1]), name: match[2], deviceCount: Number(match[3]) };
  });
  const rising = (group: Group, position: number) =>
    group.index < total && group.index > (groups[position - 1]?.index ?? -1);
  const indexed = filtered
    ? groups.every(rising)
    : groups.length === total && groups.every((group, position) => group.index === position);
  if (!indexed) throw unexpectedOutput('group list', output);
  return groups;
}
