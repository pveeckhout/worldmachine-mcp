import type { Snapshot, SnapshotDeletion } from '../../../domain/snapshot.js';

/**
 * Snapshots (spec v2b sections 4-5). A `snapshot` argument is a name or `#<index>`; the adapter resolves it against
 * its own `snapshot list` and sends `#<index>`. Callers run the changes inside `WorldMachineSessionPort.exclusive`.
 * A create, restore, or delete World Machine did not reject marks the session dirty.
 */
export interface SnapshotPort {
  list(): Promise<Snapshot[]>;
  /** Refuses an invalid name or one a snapshot already has; returns the new snapshot as the list shows it. */
  create(name: string): Promise<Snapshot>;
  /** Reverts the graph to the snapshot (fact 60) and returns it. */
  restore(snapshot: string): Promise<Snapshot>;
  remove(snapshot: string): Promise<SnapshotDeletion>;
}
