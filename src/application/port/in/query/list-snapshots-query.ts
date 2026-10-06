import type { SessionSummary } from '../../../../domain/session.js';
import type { Snapshot } from '../../../../domain/snapshot.js';

export type ListSnapshotsQuery = Readonly<Record<string, never>>;
export type SnapshotListView = { readonly snapshots: readonly Snapshot[]; readonly session: SessionSummary };
export interface ListSnapshotsQueryPort {
  listSnapshots(query: ListSnapshotsQuery): Promise<SnapshotListView>;
}
