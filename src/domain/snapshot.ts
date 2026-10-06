/** A snapshot as `snapshot list` prints it (spec v2b fact 57); `created` is World Machine's `YYYY-MM-DD HH:MM`. */
export type Snapshot = { readonly index: number; readonly name: string; readonly created: string };
