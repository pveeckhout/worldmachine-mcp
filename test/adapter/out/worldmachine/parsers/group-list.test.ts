import { describe, expect, it } from 'vitest';
import { parseGroupList } from '../../../../../src/adapter/out/worldmachine/parsers/group-list.js';
import { codeOf, fixtureLines } from './fixture.js';

describe('parseGroupList', () => {
  it('reads groups, including names with punctuation and zero devices', () => {
    const groups = parseGroupList(fixtureLines('group-list.txt'));
    expect(groups).toHaveLength(5);
    expect(groups[0]).toEqual({ index: 0, name: 'Create your Terrain', deviceCount: 6 });
    expect(groups[3]).toEqual({ index: 3, name: 'Welcome to World Machine!', deviceCount: 0 });
  });

  it('reads an empty project (spec fact 21)', () => {
    expect(parseGroupList(['No groups in the current project.'])).toEqual([]);
  });

  it('fails on a count mismatch', () => {
    expect(codeOf(() => parseGroupList(['Groups (2 total):', '  [#0] A (1 device)']))).toBe(
      'UNEXPECTED_OUTPUT',
    );
  });
});
