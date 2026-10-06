import { unexpectedOutput } from './unexpected.js';

const HEADER = /^Successfully exported (\d+) file\(s\):$/;
const ROW = /^ {2}(\S.*)$/;

/**
 * Fact 50: the header, then one absolute path per file. The count must match the listed paths. A Material Output
 * is one listed path that writes four files.
 */
export function parseExportAll(output: readonly string[]): string[] {
  const [header, ...rows] = output;
  const count = HEADER.exec(header?.trim() ?? '');
  if (!count) throw unexpectedOutput('export all', output);
  const files = rows
    .filter((row) => row.trim() !== '')
    .map((row) => {
      const path = ROW.exec(row)?.[1];
      if (path === undefined) throw unexpectedOutput('export all', output);
      return path;
    });
  if (files.length !== Number(count[1])) throw unexpectedOutput('export all', output);
  return files;
}
