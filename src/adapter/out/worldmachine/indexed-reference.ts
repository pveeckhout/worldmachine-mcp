import { WorldMachineError } from '../../../domain/errors.js';
import { idOfReference } from './device-reference.js';

/** A listed item that commands address as `#<index>`: a snapshot or a group (spec v2b section 4). */
export type Indexed = { readonly index: number; readonly name: string };

export type IndexedKind = {
  /** For messages: `snapshot` or `group`. */
  readonly what: string;
  /** The tool that lists them, for messages. */
  readonly listTool: string;
  /** Whether a listed name is the name a reference gives. */
  readonly sameName: (listed: string, wanted: string) => boolean;
};

/**
 * The listed item a reference names, resolved by the server, never by World Machine (spec v2b section 4): `#<n>` must
 * be an index in the list that no item at another index has as its name, and a name must match exactly one item.
 * Anything else is REFUSED before a command uses it. Callers list the items inside the same `exclusive()` action, so
 * no other command can shift the indexes.
 */
export function resolveIndexed<T extends Indexed>(
  items: readonly T[],
  reference: string,
  kind: IndexedKind,
): T {
  const index = idOfReference(reference);
  if (index !== undefined) {
    const item = items.find((candidate) => candidate.index === index);
    if (item === undefined) {
      throw new WorldMachineError(
        'REFUSED',
        `No ${kind.what} #${index} in the current project; see ${kind.listTool}`,
      );
    }
    // Fail closed: an item named like the index (made in the window) would otherwise be shadowed by it.
    const namesakes = items.filter(
      (candidate) => candidate.index !== index && kind.sameName(candidate.name, reference),
    );
    if (namesakes.length > 0) {
      const indexes = namesakes.map((namesake) => `#${namesake.index}`).join(', ');
      throw new WorldMachineError(
        'REFUSED',
        `'${reference}' is both an index and the name of ${indexes}; use the other item's index or rename it in the window`,
      );
    }
    return item;
  }
  const matches = items.filter((candidate) => kind.sameName(candidate.name, reference));
  if (matches.length > 1) {
    const indexes = matches.map((match) => `#${match.index}`).join(', ');
    throw new WorldMachineError(
      'REFUSED',
      `The ${kind.what} name '${reference}' matches ${indexes}; use #<index>`,
    );
  }
  const match = matches[0];
  if (match === undefined) {
    throw new WorldMachineError(
      'REFUSED',
      `No ${kind.what} '${reference}' in the current project; see ${kind.listTool}`,
    );
  }
  return match;
}
