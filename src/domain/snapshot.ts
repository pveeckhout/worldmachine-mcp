/** A snapshot as `snapshot list` prints it (spec v2b fact 57); `created` is World Machine's `YYYY-MM-DD HH:MM`. */
export type Snapshot = { readonly index: number; readonly name: string; readonly created: string };

/** A deleted snapshot and the list after the delete, whose later indexes shifted down by one (spec v2b fact 61). */
export type SnapshotDeletion = { readonly deleted: Snapshot; readonly remaining: readonly Snapshot[] };
