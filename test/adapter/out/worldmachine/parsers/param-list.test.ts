import { describe, expect, it } from 'vitest';
import { parseParamList } from '../../../../../src/adapter/out/worldmachine/parsers/param-list.js';
import { codeOf, fixtureLines, rawFrame } from './fixture.js';

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

  it('reads names with spaces, including names longer than their column', () => {
    const params = parseParamList(rawFrame('river-device.txt', 'param list #536'));
    expect(params).toHaveLength(25);
    expect(params.find((p) => p.name === 'Planform Type')).toEqual({
      name: 'Planform Type',
      type: 'enum',
      value: 'Simple Alignment',
    });
    expect(params.find((p) => p.name === 'Layout Alignment Uses Datum')).toEqual({
      name: 'Layout Alignment Uses Datum',
      type: 'bool',
      value: 'false',
    });
    expect(params.find((p) => p.name === 'Bankfull Width')).toEqual({
      name: 'Bankfull Width',
      type: 'float',
      value: '10 m',
    });
    expect(params.find((p) => p.name === 'Draw Alignment...')).toEqual({
      name: 'Draw Alignment...',
      type: 'action',
      value: '',
    });
  });

  it('reads a one-character name, not the name and its type as one (raw/enum-options.txt l.422-424)', () => {
    expect(
      parseParamList([
        "Parameters for 'VDM Features' (VDM Features):",
        '  type                      enum      Relative area',
        '  k                         float     1.0',
      ]),
    ).toEqual([
      { name: 'type', type: 'enum', value: 'Relative area' },
      { name: 'k', type: 'float', value: '1.0' },
    ]);
  });

  it('reads a device without parameters', () => {
    expect(parseParamList(["Parameters for 'X' (Y):"])).toEqual([]);
  });

  it('reads the no-parameters line as an empty list (raw/enum-options.txt l.4097 and l.4422, v1 fact 10)', () => {
    expect(parseParamList(rawFrame('enum-options.txt', 'param list #591'))).toEqual([]);
    expect(parseParamList(rawFrame('enum-options.txt', 'param list #597'))).toEqual([]);
  });

  it.each([
    [["Device 'Macro' has no parameters"]],
    [['Device Macro has no parameters.']],
    [["Device 'Macro' has no parameters.", '  Amount                    int       100']],
    [["Parameters for 'Macro' (Macro):", "Device 'Macro' has no parameters."]],
  ])('fails on a no-parameters line in another form or with other lines: %j', (lines) => {
    expect(codeOf(() => parseParamList(lines))).toBe('UNEXPECTED_OUTPUT');
  });

  it.each([[[]], [['  Amount  float  1']], [["Parameters for 'X' (Y):", 'garbage']]])(
    'fails on %j',
    (lines) => {
      expect(codeOf(() => parseParamList(lines))).toBe('UNEXPECTED_OUTPUT');
    },
  );
});
