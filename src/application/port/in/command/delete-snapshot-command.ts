import type { SessionSummary } from '../../../../domain/session.js';
import type { Snapshot } from '../../../../domain/snapshot.js';

/** `snapshot`: a snapshot name, or `#<index>` (spec v2b section 4). */
export type DeleteSnapshotCommand = { readonly snapshot: string };
export type DeleteSnapshotView = {
  readonly index: number;
  readonly name: string;
  /** The snapshots after the delete; the indexes after the deleted one shifted down by one (fact 61). */
  readonly remaining: readonly Snapshot[];
  readonly session: SessionSummary;
};
export interface DeleteSnapshotCommandPort {
  deleteSnapshot(command: DeleteSnapshotCommand): Promise<DeleteSnapshotView>;
}
