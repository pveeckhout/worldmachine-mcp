import { describe, expect, it } from 'vitest';
import { parseParamGet } from '../../../../../src/adapter/out/worldmachine/parsers/param-get.js';
import { codeOf } from './fixture.js';

describe('parseParamGet', () => {
  it('reads the value after the reference (raw/v6b-param-set.txt l.87-88, 192-193)', () => {
    expect(parseParamGet(['#1.Width = 4 km'], '#1.Width')).toBe('4 km');
    expect(parseParamGet(['#2.filename = <WORK>/dir with space/out file.png'], '#2.filename')).toBe(
      '<WORK>/dir with space/out file.png',
    );
  });

  it('reports output for another reference as UNEXPECTED_OUTPUT', () => {
    expect(codeOf(() => parseParamGet(['#1.Direction = 3'], '#1.Width'))).toBe('UNEXPECTED_OUTPUT');
    expect(codeOf(() => parseParamGet([], '#1.Width'))).toBe('UNEXPECTED_OUTPUT');
  });
});
