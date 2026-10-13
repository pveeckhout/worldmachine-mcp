import { unexpectedOutput } from './unexpected.js';

// Fact 93 (raw/build-not-built-timing.txt l.72-90): `debug devicetiming #<id>` prints a title naming the device and
// its id, a column header, then one row per result level (`129px`, l.87-89) or `  (no finished results)` (l.75), then a
// legend line (l.76). The name may hold anything, so the id is read from the end of the title.
const TITLE = /^Build timing for '.*' \(#(\d+)\), per result level:$/;
const COLUMNS = /^Device\s+Prepare\s+Activate\s+Distrib\s+Total$/;
const NONE = '(no finished results)';
// A result level and four times in ms (l.87-89, l.170-172); plan decision B11 accepts nothing else.
const RESULT = /^\d+px(?:\s+\d+ms){4}$/;
// l.76, verbatim.
const LEGEND =
  "Prepare = input clone/validate/rescale, Activate = the device's own work (the workview number), Distrib = output hand-off to children.";

/** Whether device `#<id>` has a finished result; any other shape is UNEXPECTED_OUTPUT (design section 4 step 3). */
export function hasFinishedResults(id: number, output: readonly string[]): boolean {
  // No line is dropped: the frame already comes without blank lines at either end (frame-assembler.ts l.47-53), so a
  // blank line here is inside the table and is unexpected (plan decision B11).
  const [title, columns, ...rows] = output.map((line) => line.trimEnd());
  const legend = rows.pop();
  const framed =
    TITLE.exec(title ?? '')?.[1] === String(id) &&
    COLUMNS.test(columns ?? '') &&
    legend === LEGEND &&
    rows.length > 0;
  if (framed && rows.length === 1 && rows[0]?.trim() === NONE) return false;
  if (framed && rows.every((row) => RESULT.test(row))) return true;
  throw unexpectedOutput(`debug devicetiming #${id}`, output);
}
