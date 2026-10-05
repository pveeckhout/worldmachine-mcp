import { WorldMachineError } from '../../../domain/errors.js';

export const SENTINEL_PREFIX = '__end_';

// C0 controls, DEL, C1 controls (U+0080-U+009F), and the Unicode line and paragraph separators.
// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the purpose of this pattern
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

/**
 * Commands built with a free-text tail whose last word World Machine may read as its `force` flag
 * (`project open <path> [force]` in raw/help.txt). `project open` is the only one: `project close` and `project new`
 * also take `force` but are never built with a tail. A future command with both must add itself here.
 */
const FORCE_FLAG_COMMANDS = new Set(['project open']);
const ENDS_IN_FORCE = /(?:^|\s)force$/i;

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
 * contain spaces (spec section 2, fact 11). World Machine accepts a quoted device name (fact 18, V4), but this
 * builder never emits quotes: a device anywhere but the tail is referenced as `#<id>`. A space anywhere but the
 * tail, any quote or backslash, and a tail ending in the word `force` on a command that takes a force flag are
 * refused (spec section 9: ambiguous tokens are refused).
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
      'Quotes and backslashes are not supported in arguments; refer to devices by #<id>',
    );
  }
  if (tail.trim() === '' || tail !== tail.trim()) {
    throw new WorldMachineError(
      'REFUSED',
      'The final argument must not be blank or start or end with spaces',
    );
  }
  if (FORCE_FLAG_COMMANDS.has(words.join(' ')) && ENDS_IN_FORCE.test(tail)) {
    throw new WorldMachineError(
      'REFUSED',
      'The final argument must not end with the word force, which World Machine reads as a flag',
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
