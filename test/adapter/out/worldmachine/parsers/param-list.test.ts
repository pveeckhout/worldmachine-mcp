import { describe, expect, it } from 'vitest';
import { parseParamList } from '../../../../../src/adapter/out/worldmachine/parsers/param-list.js';
import { codeOf, fixtureLines } from './fixture.js';

describe('parseParamList', () => {
  it('reads every row, keeping units and empty values as raw text', () => {
    const params = parseParamList(fixtureLines('param-list-erosion.txt'));
    expect(params).toHaveLength(20);
    expect(params[0]).toEqual({ name: 'Amount', type: 'float', value: '60.0' });
    expect(params.find((p) => p.name === 'featureScale')).toEqual({
      name: 'featureScale',
      type: 'float',
      value: '400 m',
    });
    expect(params.find((p) => p.name === 'groupBasic')).toEqual({
      name: 'groupBasic',
      type: 'other',
      value: '',
    });
    expect(params.find((p) => p.name === 'soilMask')).toEqual({
      name: 'soilMask',
      type: 'enum',
      value: 'Presence Mask',
    });
  });

  it('keeps spaces inside values', () => {
    expect(
      parseParamList([
        "Parameters for 'Height Output' (Height Output):",
        '  filename                  filename  <project> <name>-<res>.png',
      ]),
    ).toEqual([{ name: 'filename', type: 'filename', value: '<project> <name>-<res>.png' }]);
  });

  it('reads a device without parameters', () => {
    expect(parseParamList(["Parameters for 'X' (Y):"])).toEqual([]);
  });

  it.each([[[]], [['  Amount  float  1']], [["Parameters for 'X' (Y):", 'garbage']]])(
    'fails on %j',
    (lines) => {
      expect(codeOf(() => parseParamList(lines))).toBe('UNEXPECTED_OUTPUT');
    },
  );
});
