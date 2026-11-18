// The transcript format of scripts/capture-fixtures.mjs: `>>> <command>` ... `<<<` sections. The readers of the enum
// and port-type catalogs share it (port-types plan decision D19), and render writes it.
import { LOG_LINE } from '../../../../domain/errors.js';

// src/adapter/out/worldmachine/parsers/system-info.ts VERSION (raw/system-info.txt l.3).
const VERSION = /^\s*Version:\s+Build (\d+) '[^']*'\s*$/;

/**
 * One captured command and the lines it answered. `unsolicited` holds the lines World Machine printed on its own
 * before the command (render writes them as a `(printed between batches)` section); transcriptSections never sets it.
 */
export type Section = { command: string; lines: string[]; unsolicited?: string[] | undefined };

/** Splits a transcript into its `>>> <command>` ... `<<<` sections; log lines and blank lines are dropped. */
export function transcriptSections(text: string): Section[] {
  const sections: Section[] = [];
  let current: Section | undefined;
  for (const line of text.split('\n')) {
    if (line.startsWith('>>> ')) {
      current = { command: line.slice(4), lines: [] };
      sections.push(current);
    } else if (line === '<<<') {
      current = undefined;
    } else if (current !== undefined && line.trim() !== '' && !LOG_LINE.test(line)) {
      current.lines.push(line);
    }
  }
  return sections;
}

/** The build a `system info` capture reports; exactly one Version line, as parsers/system-info.ts requires. */
export function buildOfSystemInfo(text: string): number {
  const builds = text.split('\n').flatMap((line) => {
    const match = VERSION.exec(line);
    return match?.[1] === undefined ? [] : [Number(match[1])];
  });
  if (builds.length !== 1) throw new Error(`system info: expected one Version line, found ${builds.length}`);
  return builds[0] as number;
}

/**
 * The transcript text of sections, as scripts/capture-fixtures.mjs writes it: each command (through `scrub`, which
 * keeps machine paths out of the fixtures) and its lines between `>>> ` and `<<<`, lines printed between batches in
 * a section of their own before the command they preceded.
 */
export function render(
  sections: readonly Section[],
  scrub: (text: string) => string = (text) => text,
): string {
  const block = (command: string, lines: readonly string[]) =>
    [`>>> ${scrub(command)}`, ...lines, '<<<'].join('\n');
  return `${sections
    .flatMap(({ command, lines, unsolicited }) => [
      ...(unsolicited ? [block('(printed between batches)', unsolicited)] : []),
      block(command, lines),
    ])
    .join('\n')}\n`;
}
