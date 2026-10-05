import type { Parameter } from '../../../../domain/device.js';
import { unexpectedOutput } from './unexpected.js';

const HEADER = /^Parameters for '.*' \(.*\):$/;
const ROW = /^\s{2}(\S+)\s+(\S+)(?:\s+(.*?))?\s*$/;

export function parseParamList(output: readonly string[]): Parameter[] {
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
