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

/** The build event a line carries, or undefined. `Preview build started.` is a command answer, not an event. */
export function parseBuildEvent(line: string): BuildEvent | undefined {
  return EVENTS.get(line);
}
