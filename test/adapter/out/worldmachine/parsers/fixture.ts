import { readFileSync } from 'node:fs';
import { parseBuildEvent } from '../../../../../src/adapter/out/worldmachine/build-events.js';
import { LOG_LINE } from '../../../../../src/domain/errors.js';

export function fixtureLines(name: string): string[] {
  return readFileSync(new URL(`../../../../fixtures/wm-4067/${name}`, import.meta.url), 'utf8')
    .split('\n')
    .filter((line, index, all) => !(line === '' && index === all.length - 1));
}

/**
 * The output of the `occurrence`-th `>>> <command>` block of a raw transcript as it reaches a parser: log lines and
 * build events removed (spec v2a section 5), blank lines at either end trimmed.
 */
export function rawFrame(name: string, command: string, occurrence = 0): string[] {
  const lines = fixtureLines(`raw/${name}`);
  const starts = lines.flatMap((line, index) => (line === `>>> ${command}` ? [index] : []));
  const start = starts[occurrence];
  if (start === undefined) throw new Error(`raw/${name} has no block ${occurrence} for ${command}`);
  const body = lines
    .slice(start + 1, lines.indexOf('<<<', start))
    .filter((line) => !LOG_LINE.test(line) && parseBuildEvent(line) === undefined);
  while (body[0]?.trim() === '') body.shift();
  while (body.length > 0 && body[body.length - 1]?.trim() === '') body.pop();
  return body;
}

export function codeOf(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}
