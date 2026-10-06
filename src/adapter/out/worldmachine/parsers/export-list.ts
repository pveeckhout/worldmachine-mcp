import type { ExportTarget } from '../../../../domain/output-template.js';
import { unexpectedOutput } from './unexpected.js';

const HEADER = 'Configured exports:';
// Fact 49: two spaces, the device name in quotes padded to 20 characters, ` -> `, the template.
// Assumed (A3): a longer name is printed whole; the pattern accepts any length.
const ROW = /^ {2}'(.*)' -> (.+)$/;

export function parseExportList(output: readonly string[]): ExportTarget[] {
  const [header, ...rows] = output;
  if (header?.trim() !== HEADER) throw unexpectedOutput('export list', output);
  // Assumed: a project without outputs prints the header alone; no capture shows one.
  return rows
    .filter((row) => row.trim() !== '')
    .map((row): ExportTarget => {
      const match = ROW.exec(row);
      const device = match?.[1]?.trimEnd();
      if (!device || match?.[2] === undefined) throw unexpectedOutput('export list', output);
      // More than one `' -> '` makes the split a guess; flag it so the export check refuses the target.
      const ambiguous = row.slice(3).split("' -> ").length > 2;
      return ambiguous ? { device, template: match[2], ambiguous: true } : { device, template: match[2] };
    });
}
