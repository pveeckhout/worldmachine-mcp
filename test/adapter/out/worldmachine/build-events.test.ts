import { describe, expect, it } from 'vitest';
import { parseBuildEvent } from '../../../../src/adapter/out/worldmachine/build-events.js';
import type { BuildEvent } from '../../../../src/domain/build.js';
import { fixtureLines } from './parsers/fixture.js';

const TRANSCRIPTS = [
  'v2-build-concurrency.txt',
  'v2-build-export.txt',
  'v2-build-isolate.txt',
  'v2-build-long.txt',
  'v2b-groups.txt',
] as const;

function eventsOf(name: string): BuildEvent[] {
  return fixtureLines(`raw/${name}`).flatMap((line) => {
    const event = parseBuildEvent(line);
    return event === undefined ? [] : [event];
  });
}

describe('parseBuildEvent (spec v2a section 5)', () => {
  it.each(TRANSCRIPTS)('classifies every [Build Event] line of raw/%s', (name) => {
    const lines = fixtureLines(`raw/${name}`).filter((line) => line.startsWith('[Build Event] '));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(parseBuildEvent(line), line).toBeDefined();
  });

  it('reads raw/v2-build-export.txt in order', () => {
    expect(eventsOf('v2-build-export.txt')).toEqual([
      'sleep-prohibited',
      'starting',
      'ended',
      'sleep-allowed',
      'build-started',
      'sleep-prohibited',
      'starting',
      'ended',
      'sleep-allowed',
      'build-started',
      'sleep-prohibited',
      'sleep-allowed',
      'tiled-started',
    ]);
  });

  it('reads the replaced and stopped builds of raw/v2-build-long.txt in order', () => {
    expect(eventsOf('v2-build-long.txt')).toEqual([
      'sleep-prohibited',
      'starting',
      'ended',
      'sleep-prohibited',
      'starting',
      'sleep-allowed',
      'ended',
      'sleep-allowed',
      'sleep-prohibited',
      'sleep-allowed',
    ]);
  });

  it('reads the late confirmations of raw/v2-build-concurrency.txt and raw/v2-build-isolate.txt', () => {
    expect(eventsOf('v2-build-concurrency.txt').filter((event) => event === 'tiled-started')).toHaveLength(2);
    expect(eventsOf('v2-build-isolate.txt').filter((event) => event === 'build-started')).toHaveLength(2);
  });

  it('reads the group build of raw/v2b-groups.txt in order, ending with its late line (spec v2b fact 66)', () => {
    expect(eventsOf('v2b-groups.txt')).toEqual([
      'sleep-prohibited',
      'starting',
      'ended',
      'sleep-allowed',
      'group-build-started',
    ]);
    expect(parseBuildEvent("Building 6 device(s) in group 'Create your Terrain'")).toBe(
      'group-build-started',
    );
    expect(parseBuildEvent("Building 5 device(s) in group 'Texture & View'")).toBe('group-build-started');
  });

  it.each([
    'Preview build started.',
    'Build in progress...',
    'No build running.',
    'Stop requested.',
    '[Build Event] Something else',
    ' Build started.',
    'Build started. ',
    '[Info       ] Closing current project',
    "Building 6 device(s) in group 'Create your Terrain' ",
    " Building 6 device(s) in group 'Create your Terrain'",
    "Building 6 devices in group 'Create your Terrain'",
    "Building device(s) in group 'Create your Terrain'",
    "Disabled 6 device(s) in group 'Create your Terrain'",
    "Group 'Welcome to World Machine!' contains no devices.",
  ])('does not classify %j', (line) => {
    expect(parseBuildEvent(line)).toBeUndefined();
  });
});
