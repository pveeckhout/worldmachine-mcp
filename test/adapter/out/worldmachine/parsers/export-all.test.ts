import { describe, expect, it } from 'vitest';
import { parseExportAll } from '../../../../../src/adapter/out/worldmachine/parsers/export-all.js';
import { codeOf, rawFrame } from './fixture.js';

describe('parseExportAll (fact 50)', () => {
  it('reads the exported paths (raw/v2-build-export.txt l.85-92)', () => {
    expect(parseExportAll(rawFrame('v2-build-export.txt', 'export all'))).toEqual([
      '<WORK>/build-test Height Output-257.png',
      '<WORK>/build-test Material Output 257.png',
      '<WORK>/build-test Colormap only 257.png',
      '<WORK>/build-test Splatmap 257.png',
    ]);
  });

  it('fails when the count does not match the listed paths', () => {
    expect(
      codeOf(() => parseExportAll(['Successfully exported 2 file(s):', '  /r/a Height Output-257.png'])),
    ).toBe('UNEXPECTED_OUTPUT');
  });

  it('fails without its header', () => {
    expect(codeOf(() => parseExportAll(['  /r/a Height Output-257.png']))).toBe('UNEXPECTED_OUTPUT');
  });
});
