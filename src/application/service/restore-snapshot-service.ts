import type {
  RestoreSnapshotCommand,
  RestoreSnapshotCommandPort,
  RestoreSnapshotView,
} from '../port/in/command/restore-snapshot-command.js';
import type { SnapshotPort } from '../port/out/snapshot-port.js';
import type { WorldMachineSessionPort } from '../port/out/world-machine-session-port.js';

export class RestoreSnapshotService implements RestoreSnapshotCommandPort {
  readonly #session: WorldMachineSessionPort;
  readonly #snapshots: SnapshotPort;

  constructor(session: WorldMachineSessionPort, snapshots: SnapshotPort) {
    this.#session = session;
    this.#snapshots = snapshots;
  }

  /** The port resolves the reference against its own list inside this exclusive section (spec v2b section 4). */
  restoreSnapshot(command: RestoreSnapshotCommand): Promise<RestoreSnapshotView> {
    return this.#session.exclusive(async () => {
      const { index, name } = await this.#snapshots.restore(command.snapshot);
      return { index, name, session: this.#session.status().session };
    });
  }
}
