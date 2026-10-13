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

// Fact 95 (raw/build-stop-timing.txt l.187-189): a device a stopped build never reached prints one line naming it.
const NO_RESULTS_YET = /^'.*' has no build results yet\.$/;

/**
 * Whether device `#<id>` is built: its table has a row at the scene resolution (`<resolution>px`; fact 95, a stopped
 * build leaves lower levels only). A table without that row, `(no finished results)`, and `'<name>' has no build
 * results yet.` are not built; any other shape is UNEXPECTED_OUTPUT (design section 4 step 2).
 */
export function isBuiltAtResolution(id: number, output: readonly string[], resolution: number): boolean {
  if (output.length === 1 && NO_RESULTS_YET.test(output[0] ?? '')) return false;
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
  if (framed && rows.every((row) => RESULT.test(row))) {
    return rows.some((row) => row.startsWith(`${resolution}px`));
  }
  throw unexpectedOutput(`debug devicetiming #${id}`, output);
}
