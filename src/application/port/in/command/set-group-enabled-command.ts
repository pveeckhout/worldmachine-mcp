import type { SessionSummary } from '../../../../domain/session.js';

/** `group`: a group name, compared regardless of case, or `#<index>` (spec v2b section 4). */
export type SetGroupEnabledCommand = { readonly group: string; readonly enabled: boolean };
export type SetGroupEnabledView = {
  readonly index: number;
  readonly name: string;
  /** 0 for a group without devices, which changes nothing (fact 65). */
  readonly deviceCount: number;
  readonly enabled: boolean;
  readonly session: SessionSummary;
};
export interface SetGroupEnabledCommandPort {
  setGroupEnabled(command: SetGroupEnabledCommand): Promise<SetGroupEnabledView>;
}
