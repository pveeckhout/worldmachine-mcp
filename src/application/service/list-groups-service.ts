import type {
  GroupListView,
  ListGroupsQuery,
  ListGroupsQueryPort,
} from '../port/in/query/list-groups-query.js';
import type { GroupPort } from '../port/out/group-port.js';
import type { WorldMachineSessionPort } from '../port/out/world-machine-session-port.js';

export class ListGroupsService implements ListGroupsQueryPort {
  readonly #session: WorldMachineSessionPort;
  readonly #groups: GroupPort;

  constructor(session: WorldMachineSessionPort, groups: GroupPort) {
    this.#session = session;
    this.#groups = groups;
  }

  /** A read: outside `exclusive()`, so it works while a build runs (spec v2b section 3). */
  async listGroups(query: ListGroupsQuery): Promise<GroupListView> {
    const groups = await this.#groups.list(query.filter);
    return { groups, session: this.#session.status().session };
  }
}
