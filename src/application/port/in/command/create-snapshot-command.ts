import type { SessionSummary } from '../../../../domain/session.js';

export type CreateSnapshotCommand = { readonly name: string };
export type CreateSnapshotView = {
  readonly index: number;
  readonly name: string;
  readonly created: string;
  readonly session: SessionSummary;
};
export interface CreateSnapshotCommandPort {
  createSnapshot(command: CreateSnapshotCommand): Promise<CreateSnapshotView>;
}
