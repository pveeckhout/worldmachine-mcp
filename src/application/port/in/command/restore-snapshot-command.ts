import type { SessionSummary } from '../../../../domain/session.js';

/** `snapshot`: a snapshot name, or `#<index>` (spec v2b section 4). */
export type RestoreSnapshotCommand = { readonly snapshot: string };
export type RestoreSnapshotView = {
  readonly index: number;
  readonly name: string;
  readonly session: SessionSummary;
};
export interface RestoreSnapshotCommandPort {
  restoreSnapshot(command: RestoreSnapshotCommand): Promise<RestoreSnapshotView>;
}
