import type { Group } from '../../../../domain/group.js';
import type { SessionSummary } from '../../../../domain/session.js';

export type ListGroupsQuery = { readonly filter?: string };
export type GroupListView = { readonly groups: readonly Group[]; readonly session: SessionSummary };
export interface ListGroupsQueryPort {
  listGroups(query: ListGroupsQuery): Promise<GroupListView>;
}
