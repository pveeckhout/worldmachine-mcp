import type { Group } from '../../../domain/group.js';

/**
 * Device groups (spec v2b sections 4-5). Groups are created and filled in the World Machine window (fact 41). A `group`
 * argument is a name, compared regardless of case, or `#<index>`; the adapter resolves it against its own unfiltered
 * `group list` and sends `#<index>`. Callers run `setEnabled` and `resolve` inside `WorldMachineSessionPort.exclusive`.
 */
export interface GroupPort {
  /** `group list [filter]`; the header of a filtered list keeps the unfiltered total (fact 63). */
  list(filter?: string): Promise<Group[]>;
  /**
   * Sets every member device's own enabled state (fact 64) and returns the group. A group without devices changes
   * nothing (fact 65). Marks the session dirty unless the group has no devices.
   */
  setEnabled(group: string, enabled: boolean): Promise<Group>;
  /** The listed group a reference names, for `group build` (spec v2b section 5). */
  resolve(group: string): Promise<Group>;
}
