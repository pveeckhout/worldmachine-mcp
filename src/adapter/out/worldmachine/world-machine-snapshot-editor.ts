import type { SnapshotPort } from '../../../application/port/out/snapshot-port.js';
import { WorldMachineError } from '../../../domain/errors.js';
import type { Snapshot, SnapshotDeletion } from '../../../domain/snapshot.js';
import { buildCommand } from './command-builder.js';
import { requireOnlyLine } from './edit-checks.js';
import { type IndexedKind, resolveIndexed } from './indexed-reference.js';
import { parseSnapshotList } from './parsers/snapshot-list.js';
import { outputPayload } from './parsers/unexpected.js';
import { requireFrame, throwIfFailed } from './raw-response.js';
import type { WorldMachineSession } from './world-machine-session.js';

/** Spec v2b section 4: snapshot names compare exactly, case and spaces included, as World Machine compares them. */
const SNAPSHOTS: IndexedKind = {
  what: 'snapshot',
  listTool: 'list_snapshots',
  sameName: (listed, wanted) => listed === wanted,
};
/** Spec v2b section 4 and assumption B1. */
const SNAPSHOT_NAME_LIMIT = 64;
const INDEX_LIKE = /^#\d+$/;

/** Refuses a name before anything is sent (spec v2b section 4, decision D4), then applies the command builder's rules. */
function assertSnapshotName(name: string): void {
  const rule =
    name === ''
      ? 'be empty'
      : name.length > SNAPSHOT_NAME_LIMIT
        ? `be longer than ${SNAPSHOT_NAME_LIMIT} characters`
        : name !== name.trim()
          ? 'start or end with whitespace'
          : name.includes("'")
            ? "contain ', which snapshot list prints around names"
            : INDEX_LIKE.test(name)
              ? 'look like a snapshot index (#<n>)'
              : undefined;
  if (rule !== undefined) throw new WorldMachineError('REFUSED', `Snapshot name '${name}' must not ${rule}`);
  // Control characters, double quotes, backslashes, and the reserved sentinel prefix.
  buildCommand(['snapshot', 'create'], name);
}

export class WorldMachineSnapshotEditor implements SnapshotPort {
  readonly #session: WorldMachineSession;

  constructor(session: WorldMachineSession) {
    this.#session = session;
  }

  async list(): Promise<Snapshot[]> {
    this.#session.assertAcceptingCalls();
    return this.#list();
  }

  async create(name: string): Promise<Snapshot> {
    assertSnapshotName(name);
    const before = await this.#list();
    // Spec v2b section 4: World Machine accepts a repeated name (fact 58), which makes later name references ambiguous.
    const taken = before.find((snapshot) => snapshot.name === name);
    if (taken !== undefined) {
      throw new WorldMachineError(
        'REFUSED',
        `Snapshot #${taken.index} is already named '${name}'; choose another name`,
      );
    }
    const responses = await this.#session.execute([
      buildCommand(['snapshot', 'create'], name),
      'snapshot list',
    ]);
    const created = requireFrame(responses[0]);
    const list = requireFrame(responses[1]);
    throwIfFailed(created);
    // Spec v2b section 3: World Machine does not count a snapshot as a change (fact 59), but the snapshot is kept only
    // after a save, so the session counts it.
    this.#session.markDirty();
    // raw/v2b-snapshots.txt l.26-27 and l.80-81.
    requireOnlyLine(created, `Created snapshot '${name}'`, 'snapshot create');
    throwIfFailed(list);
    const after = parseSnapshotList(list.output);
    const newest = after.at(-1);
    if (after.length !== before.length + 1 || newest === undefined || newest.name !== name) {
      throw new WorldMachineError(
        'WM_COMMAND_FAILED',
        `World Machine confirmed snapshot '${name}', but snapshot list does not show it as the newest snapshot`,
        outputPayload(list.output),
      );
    }
    return newest;
  }

  async restore(reference: string): Promise<Snapshot> {
    const target = resolveIndexed(await this.#list(), reference, SNAPSHOTS);
    const response = await this.#session.executeOne(
      buildCommand(['snapshot', 'restore', `#${target.index}`]),
    );
    throwIfFailed(response);
    // Fact 60: World Machine counts a restore as a change.
    this.#session.markDirty();
    // raw/v2b-snapshots.txt l.159-160.
    requireOnlyLine(response, `Restored snapshot [#${target.index}] '${target.name}'`, 'snapshot restore');
    return target;
  }

  async remove(reference: string): Promise<SnapshotDeletion> {
    const before = await this.#list();
    const target = resolveIndexed(before, reference, SNAPSHOTS);
    const responses = await this.#session.execute([
      buildCommand(['snapshot', 'delete', `#${target.index}`]),
      'snapshot list',
    ]);
    const deleted = requireFrame(responses[0]);
    const list = requireFrame(responses[1]);
    throwIfFailed(deleted);
    this.#session.markDirty();
    // raw/v2b-snapshots.txt l.233-234 and l.243-244.
    requireOnlyLine(deleted, `Deleted snapshot [#${target.index}] '${target.name}'`, 'snapshot delete');
    throwIfFailed(list);
    const remaining = parseSnapshotList(list.output);
    // Fact 61: the snapshots after the deleted one shift down by one; nothing else changes.
    const expected = before.filter((snapshot) => snapshot.index !== target.index);
    const removed =
      remaining.length === expected.length &&
      remaining.every(
        (snapshot, position) =>
          snapshot.name === expected[position]?.name && snapshot.created === expected[position]?.created,
      );
    if (!removed) {
      throw new WorldMachineError(
        'WM_COMMAND_FAILED',
        `World Machine confirmed deleting snapshot #${target.index} '${target.name}', but snapshot list does not show it removed`,
        outputPayload(list.output),
      );
    }
    return { deleted: target, remaining };
  }

  async #list(): Promise<Snapshot[]> {
    const response = await this.#session.executeOne('snapshot list');
    throwIfFailed(response);
    return parseSnapshotList(response.output);
  }
}
