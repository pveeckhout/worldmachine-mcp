import type { Group } from '../../../../domain/group.js';
import { unexpectedOutput } from './unexpected.js';

const EMPTY = 'No groups in the current project.';
const HEADER = /^Groups \((\d+) total\):$/;
const ROW = /^\s+\[#(\d+)\]\s+(.*?)\s+\((\d+) devices?\)\s*$/;

export function parseGroupList(output: readonly string[]): Group[] {
  if (output.length === 1 && output[0]?.trim() === EMPTY) return [];
  const [header, ...rows] = output;
  const count = HEADER.exec(header?.trim() ?? '');
  if (!count) throw unexpectedOutput('group list', output);
  const groups = rows
    .filter((row) => row.trim() !== '')
    .map((row): Group => {
      const match = ROW.exec(row);
      if (!match?.[2]) throw unexpectedOutput('group list', output);
      return { index: Number(match[1]), name: match[2], deviceCount: Number(match[3]) };
    });
  if (groups.length !== Number(count[1])) throw unexpectedOutput('group list', output);
  return groups;
}
