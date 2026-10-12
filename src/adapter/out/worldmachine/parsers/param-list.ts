import type { Parameter } from '../../../../domain/device.js';
import { unexpectedOutput } from './unexpected.js';

const HEADER = /^Parameters for '.*' \(.*\):$/;
// v1 fact 10 (amended 2026-10-12): a device without parameters prints this line alone instead of a header and rows
// (raw/enum-options.txt l.4097 and l.4422).
const NONE = /^Device '.*' has no parameters\.$/;
// A name may have single spaces; at least two spaces end it, even when it overflows its column (raw/river-device.txt
// l.39: `Layout Alignment Uses Datum  bool`). The type is one word; the value is the rest of the line.
const ROW = /^\s{2}(\S(?:.*?\S)??)\s{2,}(\S+)(?:\s+(.*?))?\s*$/;

export function parseParamList(output: readonly string[]): Parameter[] {
  const shown = output.filter((line) => line.trim() !== '');
  if (shown.length === 1 && NONE.test(shown[0]?.trim() ?? '')) return [];
  const [header, ...rows] = output;
  if (header === undefined || !HEADER.test(header.trim())) throw unexpectedOutput('param list', output);
  return rows
    .filter((row) => row.trim() !== '')
    .map((row) => {
      const match = ROW.exec(row);
      if (!match?.[1] || !match[2]) throw unexpectedOutput('param list', output);
      return { name: match[1], type: match[2], value: match[3] ?? '' };
    });
}
