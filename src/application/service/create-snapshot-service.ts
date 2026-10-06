import type {
  CreateSnapshotCommand,
  CreateSnapshotCommandPort,
  CreateSnapshotView,
} from '../port/in/command/create-snapshot-command.js';
import type { SnapshotPort } from '../port/out/snapshot-port.js';
import type { WorldMachineSessionPort } from '../port/out/world-machine-session-port.js';

export class CreateSnapshotService implements CreateSnapshotCommandPort {
  readonly #session: WorldMachineSessionPort;
  readonly #snapshots: SnapshotPort;

  constructor(session: WorldMachineSessionPort, snapshots: SnapshotPort) {
    this.#session = session;
    this.#snapshots = snapshots;
  }

  /** The port lists, creates, and reads back inside this exclusive section (spec v2b section 4). */
  createSnapshot(command: CreateSnapshotCommand): Promise<CreateSnapshotView> {
    return this.#session.exclusive(async () => {
      const { index, name, created } = await this.#snapshots.create(command.name);
      return { index, name, created, session: this.#session.status().session };
    });
  }
}
