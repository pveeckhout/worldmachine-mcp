import type {
  DeleteSnapshotCommand,
  DeleteSnapshotCommandPort,
  DeleteSnapshotView,
} from '../port/in/command/delete-snapshot-command.js';
import type { SnapshotPort } from '../port/out/snapshot-port.js';
import type { WorldMachineSessionPort } from '../port/out/world-machine-session-port.js';

export class DeleteSnapshotService implements DeleteSnapshotCommandPort {
  readonly #session: WorldMachineSessionPort;
  readonly #snapshots: SnapshotPort;

  constructor(session: WorldMachineSessionPort, snapshots: SnapshotPort) {
    this.#session = session;
    this.#snapshots = snapshots;
  }

  /** The port resolves the reference against its own list inside this exclusive section (spec v2b section 4). */
  deleteSnapshot(command: DeleteSnapshotCommand): Promise<DeleteSnapshotView> {
    return this.#session.exclusive(async () => {
      const { deleted, remaining } = await this.#snapshots.remove(command.snapshot);
      return {
        index: deleted.index,
        name: deleted.name,
        remaining: remaining.map(({ index, name, created }) => ({ index, name, created })),
        session: this.#session.status().session,
      };
    });
  }
}
