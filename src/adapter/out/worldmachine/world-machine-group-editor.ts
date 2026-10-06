import type { GroupPort } from '../../../application/port/out/group-port.js';
import { WorldMachineError } from '../../../domain/errors.js';
import type { Group } from '../../../domain/group.js';
import { buildCommand } from './command-builder.js';
import { type IndexedKind, resolveIndexed } from './indexed-reference.js';
import { parseGroupList } from './parsers/group-list.js';
import { throwIfFailed } from './raw-response.js';
import type { WorldMachineSession } from './world-machine-session.js';

/**
 * Spec v2b section 4: group names compare regardless of case, as World Machine compares them (fact 64). `toLowerCase()`
 * for the reason `device-reference.ts` gives. The parser has already removed the list's padding.
 */
const GROUPS: IndexedKind = {
  what: 'group',
  listTool: 'list_groups',
  sameName: (listed, wanted) => listed.toLowerCase() === wanted.toLowerCase(),
};
// raw/v2b-groups.txt l.34-35, l.203-204, and l.257-258 (facts 64 and 65).
const CHANGED = /^(Enabled|Disabled) (\d+) device\(s\) in group '(.*)'$/;
const NO_DEVICES = /^Group '(.*)' contains no devices\.$/;

/** Whether a name World Machine printed in quotes is the listed name, whose trailing spaces the list cannot show. */
const isListedName = (printed: string | undefined, listed: string): boolean => printed?.trimEnd() === listed;

export class WorldMachineGroupEditor implements GroupPort {
  readonly #session: WorldMachineSession;

  constructor(session: WorldMachineSession) {
    this.#session = session;
  }

  async list(filter?: string): Promise<Group[]> {
    this.#session.assertAcceptingCalls();
    const command = filter === undefined ? 'group list' : buildCommand(['group', 'list'], filter);
    const response = await this.#session.executeOne(command);
    throwIfFailed(response);
    return parseGroupList(response.output, filter !== undefined);
  }

  async resolve(reference: string): Promise<Group> {
    return resolveIndexed(await this.list(), reference, GROUPS);
  }

  async setEnabled(reference: string, enabled: boolean): Promise<Group> {
    const target = await this.resolve(reference);
    const verb = enabled ? 'enable' : 'disable';
    const response = await this.#session.executeOne(buildCommand(['group', verb, `#${target.index}`]));
    throwIfFailed(response);
    const [line = '', ...rest] = response.output;
    // Fact 65: a group without devices is not an error, and nothing changes, so this answer never marks the session.
    // For a group listed with devices it contradicts the list.
    const empty = NO_DEVICES.exec(line);
    if (empty && rest.length === 0 && isListedName(empty[1], target.name)) {
      if (target.deviceCount === 0) return target;
      throw new WorldMachineError(
        'UNEXPECTED_OUTPUT',
        `World Machine reports group #${target.index} '${target.name}' as empty, but group list shows ${target.deviceCount} device(s)`,
        line,
      );
    }
    // Fact 64: World Machine counts a group change as unsaved.
    this.#session.markDirty();
    const changed = CHANGED.exec(line);
    if (
      !changed ||
      rest.length > 0 ||
      changed[1] !== (enabled ? 'Enabled' : 'Disabled') ||
      Number(changed[2]) !== target.deviceCount ||
      !isListedName(changed[3], target.name)
    ) {
      throw new WorldMachineError(
        'UNEXPECTED_OUTPUT',
        `Expected World Machine to ${verb} the ${target.deviceCount} device(s) of group #${target.index} '${target.name}'`,
        response.output.slice(0, 20).join('\n') || undefined,
      );
    }
    return target;
  }
}
