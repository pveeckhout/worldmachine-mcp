import type { BuildEvent } from '../../../domain/build.js';

// Facts 43 and 48, exactly. `[Build Event] ` does not match the log-line prefix of fact 5 (fact 47).
const EVENTS: ReadonlyMap<string, BuildEvent> = new Map([
  ['[Build Event] Prohibiting system sleep', 'sleep-prohibited'],
  ['[Build Event] *** Build Starting ***', 'starting'],
  ['[Build Event] *** Build Ended ***', 'ended'],
  ['[Build Event] System allowed to sleep again', 'sleep-allowed'],
  ['Build started.', 'build-started'],
  ['Tiled build started.', 'tiled-started'],
]);

// Spec v2b fact 66 (raw/v2b-groups.txt l.283): a group build's late line, in place of `Build started.`.
const GROUP_BUILD_STARTED = /^Building \d+ device\(s\) in group '.*'$/;

const BUILD_EVENT_PREFIX = '[Build Event] ';

/**
 * The build event a line carries, or undefined. `Preview build started.` is a command answer, not an event. Any other
 * `[Build Event] ` line, such as an automatic export (spec v2b fact 71), is an `other` event, so it never reaches a
 * command frame.
 */
export function parseBuildEvent(line: string): BuildEvent | undefined {
  const event = EVENTS.get(line) ?? (GROUP_BUILD_STARTED.test(line) ? 'group-build-started' : undefined);
  if (event !== undefined) return event;
  return line.startsWith(BUILD_EVENT_PREFIX) ? 'other' : undefined;
}
