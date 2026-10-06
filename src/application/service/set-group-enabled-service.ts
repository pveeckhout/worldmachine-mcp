import type {
  SetGroupEnabledCommand,
  SetGroupEnabledCommandPort,
  SetGroupEnabledView,
} from '../port/in/command/set-group-enabled-command.js';
import type { GroupPort } from '../port/out/group-port.js';
import type { WorldMachineSessionPort } from '../port/out/world-machine-session-port.js';

export class SetGroupEnabledService implements SetGroupEnabledCommandPort {
  readonly #session: WorldMachineSessionPort;
  readonly #groups: GroupPort;

  constructor(session: WorldMachineSessionPort, groups: GroupPort) {
    this.#session = session;
    this.#groups = groups;
  }

  /** The port resolves the reference against its own list inside this exclusive section (spec v2b section 4). */
  setGroupEnabled(command: SetGroupEnabledCommand): Promise<SetGroupEnabledView> {
    return this.#session.exclusive(async () => {
      const { index, name, deviceCount } = await this.#groups.setEnabled(command.group, command.enabled);
      return { index, name, deviceCount, enabled: command.enabled, session: this.#session.status().session };
    });
  }
}
