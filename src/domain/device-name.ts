// Device name and reference rules that the domain (graph specs and plans) and the World Machine adapter share.

const ID_REFERENCE = /^#(\d+)$/;

/** The id in a `#<id>` reference, or undefined for anything else. */
export function idOfReference(reference: string): number | undefined {
  const match = ID_REFERENCE.exec(reference);
  return match ? Number(match[1]) : undefined;
}

/**
 * World Machine matches device names regardless of case (spec fact 31). `toLowerCase()` rather than
 * `toLocaleLowerCase()`: its result does not depend on the server's locale (a Turkish locale maps `I` to a dotless
 * `ı`), and fact 31 was observed on ASCII names only, so a locale-specific mapping would add nothing verified.
 */
export const foldCase = (name: string): string => name.toLowerCase();

/** `device list` shows at most the first 23 characters of a name (spec fact 33, raw/p2c-edits.txt l.50-69). */
export const LISTED_NAME_LIMIT = 23;

/**
 * A name World Machine printed, as `device list` lists it: the first 23 characters (spec fact 33), trailing
 * whitespace trimmed as the list parser trims it, so a name whose 23rd character is a space lists shorter.
 */
export function listedName(printed: string): string {
  return printed.slice(0, LISTED_NAME_LIMIT).trimEnd();
}

/**
 * Whether a name World Machine printed is the device `device list` lists as `listed`. Truncating and trimming
 * `printed` the same way gives the listed text at any length, whether or not the command that printed it truncates
 * too (ruling K4').
 */
export function matchesListedName(printed: string, listed: string): boolean {
  return listedName(printed) === listed;
}

// Name endings that parsers/device-list.ts reads as a state marker or a kind (spec facts 24 and 29).
const MARKER_SUFFIX = /\s\[(?:disabled|bypassed)\]$/;
const KIND_SUFFIX = /\s{2,}\([^()]+\)$/;
const ID_LIKE = /^#\d+$/;

/**
 * The rule a name breaks that `device list` could not show so that it reads back as the same name, completing
 * "must not …"; undefined for a readable name (backlog, Plan 2c gate; Plan 2c decision D5).
 */
export function deviceNameProblem(name: string): string | undefined {
  return name !== name.trim()
    ? 'start or end with whitespace'
    : MARKER_SUFFIX.test(name)
      ? 'end with [disabled] or [bypassed]'
      : KIND_SUFFIX.test(name)
        ? 'end with two spaces and parenthesised text'
        : ID_LIKE.test(name)
          ? 'look like a device id (#<n>)'
          : name.length > LISTED_NAME_LIMIT
            ? `be longer than ${LISTED_NAME_LIMIT} characters`
            : undefined;
}
