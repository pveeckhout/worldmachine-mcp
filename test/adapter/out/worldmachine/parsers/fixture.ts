import { readFileSync } from 'node:fs';

export function fixtureLines(name: string): string[] {
  return readFileSync(new URL(`../../../../fixtures/wm-4067/${name}`, import.meta.url), 'utf8')
    .split('\n')
    .filter((line, index, all) => !(line === '' && index === all.length - 1));
}

export function codeOf(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}
