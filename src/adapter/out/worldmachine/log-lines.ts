export type LogLine = { readonly level: string; readonly text: string };

const LOG_LINE = /^\[([A-Za-z]+)\s*\] (.*)$/;
const LICENCE = /licen[cs]e/i;

export function parseLogLine(line: string): LogLine | undefined {
  const match = LOG_LINE.exec(line);
  if (!match) return undefined;
  return { level: (match[1] ?? '').toLowerCase(), text: match[2] ?? '' };
}

export function isLicenceText(text: string): boolean {
  return LICENCE.test(text);
}
