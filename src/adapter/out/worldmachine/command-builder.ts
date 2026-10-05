import { WorldMachineError } from '../../../domain/errors.js';

export const SENTINEL_PREFIX = '__end_';

// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the purpose of this pattern
const CONTROL = /[\u0000-\u001f\u007f]/;

function assertSafe(value: string): void {
  if (CONTROL.test(value)) {
    throw new WorldMachineError('REFUSED', 'Arguments must not contain control characters such as newlines');
  }
  if (value.startsWith(SENTINEL_PREFIX)) {
    throw new WorldMachineError(
      'REFUSED',
      `Arguments must not start with the reserved prefix ${SENTINEL_PREFIX}`,
    );
  }
}

/**
 * Builds one World Machine console line. `words` are single tokens; `tail` is the final argument and may
 * contain spaces (spec section 2, fact 11). Quoting rules are unverified (V4), so a space anywhere but the tail,
 * and any quote or backslash, is refused (spec section 9: ambiguous tokens are refused).
 */
export function buildCommand(
  words: readonly string[],
  tail?: string,
  suffix: readonly string[] = [],
): string {
  for (const word of [...words, ...suffix]) {
    assertSafe(word);
    if (word === '' || /[\s"'\\]/.test(word)) {
      throw new WorldMachineError('REFUSED', `"${word}" must be a single word without spaces`);
    }
  }
  if (tail === undefined) return [...words, ...suffix].join(' ');
  assertSafe(tail);
  if (/["'\\]/.test(tail)) {
    throw new WorldMachineError(
      'REFUSED',
      'Quotes and backslashes are not supported until World Machine quoting rules are verified',
    );
  }
  if (tail.trim() === '' || tail !== tail.trim()) {
    throw new WorldMachineError(
      'REFUSED',
      'The final argument must not be blank or start or end with spaces',
    );
  }
  return [...words, tail, ...suffix].join(' ');
}

export function sentinel(batchId: string, index: number): string {
  return `${SENTINEL_PREFIX}${batchId}_${index}`;
}

export function sentinelEcho(batchId: string, index: number): string {
  return `Error: Unknown command: '${sentinel(batchId, index)}'`;
}
