import { unexpectedOutput } from './parsers/unexpected.js';
import type { RawResponse } from './raw-response.js';
import type { WorldMachineSession } from './world-machine-session.js';

/** Requires `line` among a command's output lines; anything else is UNEXPECTED_OUTPUT for `what`. */
export function requireLine(response: RawResponse, line: string, what: string): void {
  if (!response.output.includes(line)) throw unexpectedOutput(what, response.output);
}

/** The first output line matching `pattern` (no `g` flag); none is UNEXPECTED_OUTPUT for `what`. */
export function requireMatch(response: RawResponse, pattern: RegExp, what: string): RegExpExecArray {
  for (const line of response.output) {
    const match = pattern.exec(line);
    if (match) return match;
  }
  throw unexpectedOutput(what, response.output);
}

/**
 * Runs the read-back that follows a change World Machine accepted. When the read-back fails, nothing shows whether
 * World Machine acted, so the project counts as modified before the error propagates (ruling C2).
 */
export function readBack<T>(session: WorldMachineSession, read: () => T): T {
  try {
    return read();
  } catch (error) {
    session.markDirty();
    throw error;
  }
}
