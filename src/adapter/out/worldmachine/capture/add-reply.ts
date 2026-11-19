// The answer to a `device add <word>` of scripts/capture-fixtures.mjs (freshDevice). It used to take the newest listed
// device without reading the answer, so a refused add went on with a device that was already there
// (wm-4070/raw/build-not-built-timing.txt l.23-32: `File Output` refused, then `#2` wired to itself).
import { ambiguousMatches } from './discovery.js';

const ADDED = /^Added '.*'$/;

/**
 * The word to add instead when a word is ambiguous. Build 4067 added a Height Output for `File Output`
 * (wm-4067/raw/v3-rename-types.txt l.204-205); build 4069 and later refuse that word
 * (wm-4070/raw/build-not-built-timing.txt l.23-24).
 */
export const ADD_FALLBACK: Readonly<Record<string, string>> = { 'File Output': 'Height Output' };

export type AddOutcome =
  | { readonly kind: 'added' }
  | { readonly kind: 'retry'; readonly word: string }
  | { readonly kind: 'refused' };

/** Whether `device add <word>` added a device, should be retried with another word, or was refused. */
export function addOutcome(word: string, reply: readonly string[]): AddOutcome {
  const lines = reply.map((line) => line.trim());
  if (lines.some((line) => ADDED.test(line))) return { kind: 'added' };
  const fallback = Object.hasOwn(ADD_FALLBACK, word) ? ADD_FALLBACK[word] : undefined;
  if (fallback !== undefined && lines.some((line) => ambiguousMatches(line)?.includes(fallback)))
    return { kind: 'retry', word: fallback };
  return { kind: 'refused' };
}
