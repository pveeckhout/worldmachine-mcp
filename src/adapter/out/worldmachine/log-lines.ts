import { LICENCE, LOG_LINE } from '../../../domain/errors.js';

export type LogLine = { readonly level: string; readonly text: string };

export function parseLogLine(line: string): LogLine | undefined {
  const match = LOG_LINE.exec(line);
  if (!match) return undefined;
  return { level: (match[1] ?? '').toLowerCase(), text: line.slice(match[0].length) };
}

export function isLicenceText(text: string): boolean {
  return LICENCE.test(text);
}
