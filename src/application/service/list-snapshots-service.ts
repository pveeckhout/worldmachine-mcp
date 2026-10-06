import type {
  ListSnapshotsQuery,
  ListSnapshotsQueryPort,
  SnapshotListView,
} from '../port/in/query/list-snapshots-query.js';
import type { SnapshotPort } from '../port/out/snapshot-port.js';
import type { WorldMachineSessionPort } from '../port/out/world-machine-session-port.js';

export class ListSnapshotsService implements ListSnapshotsQueryPort {
  readonly #session: WorldMachineSessionPort;
  readonly #snapshots: SnapshotPort;

  constructor(session: WorldMachineSessionPort, snapshots: SnapshotPort) {
    this.#session = session;
    this.#snapshots = snapshots;
  }

  /** A read: outside `exclusive()`, so it works while a build runs (spec v2b section 3). */
  async listSnapshots(_query: ListSnapshotsQuery): Promise<SnapshotListView> {
    const snapshots = await this.#snapshots.list();
    return { snapshots, session: this.#session.status().session };
  }
}
