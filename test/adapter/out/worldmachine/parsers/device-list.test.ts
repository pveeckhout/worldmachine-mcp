import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDeviceList } from '../../../../../src/adapter/out/worldmachine/parsers/device-list.js';
import type { WorldMachineError } from '../../../../../src/domain/errors.js';

const fixture = readFileSync(new URL('../../../../fixtures/wm-4067/device-list.txt', import.meta.url), 'utf8')
  .split('\n')
  .filter((line) => line !== '');

function code(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    return (error as WorldMachineError).code;
  }
  return undefined;
}

describe('parseDeviceList', () => {
  it('reads every device with id, name, and optional kind', () => {
    const devices = parseDeviceList(fixture);
    expect(devices).toHaveLength(17);
    expect(devices[0]).toEqual({ id: 1, name: 'Height Output', enabled: true, bypassed: false });
    expect(devices.find((d) => d.id === 309)).toEqual({
      id: 309,
      name: 'Colormap only',
      enabled: true,
      bypassed: false,
      kind: 'Bitmap Output',
    });
    expect(devices.find((d) => d.id === 319)).toEqual({
      id: 319,
      name: 'Easy Distortion',
      kind: 'Macro',
      enabled: true,
      bypassed: false,
    });
  });

  it('keeps single-spaced parentheses inside a name', () => {
    expect(parseDeviceList(['Devices (1 total):', '  #7     My (old) Perlin         '])).toEqual([
      { id: 7, name: 'My (old) Perlin', enabled: true, bypassed: false },
    ]);
  });

  it('reads an empty project', () => {
    expect(parseDeviceList(['No devices in the current project.'])).toEqual([]);
  });

  it('accepts fewer rows than the header total when the list was filtered', () => {
    expect(parseDeviceList(['Devices (17 total):', '  #1     Height Output           '], true)).toEqual([
      { id: 1, name: 'Height Output', enabled: true, bypassed: false },
    ]);
  });

  it('still rejects more rows than the header total when filtered', () => {
    expect(code(() => parseDeviceList(['Devices (1 total):', '  #1     A', '  #2     B'], true))).toBe(
      'UNEXPECTED_OUTPUT',
    );
  });

  describe('state markers', () => {
    const one = (row: string) => parseDeviceList(['Devices (1 total):', row]);

    it('reads [disabled] from a captured row (p2b-graph-edits.txt)', () => {
      expect(one('  #1     Gradient                 [disabled]')).toEqual([
        { id: 1, name: 'Gradient', enabled: false, bypassed: false },
      ]);
    });

    it('reads [bypassed] from a captured row (p2b-graph-edits.txt)', () => {
      expect(one('  #1     Gradient                 [bypassed]')).toEqual([
        { id: 1, name: 'Gradient', enabled: true, bypassed: true },
      ]);
    });

    it.each(['[disabled] [bypassed]', '[bypassed] [disabled]'])('reads both markers as %s', (markers) => {
      expect(one(`  #1     Gradient                 ${markers}`)).toEqual([
        { id: 1, name: 'Gradient', enabled: false, bypassed: true },
      ]);
    });

    it('reads a kind followed by a marker', () => {
      expect(one('  #319   Easy Distortion          (Macro)  [bypassed]')).toEqual([
        { id: 319, name: 'Easy Distortion', kind: 'Macro', enabled: true, bypassed: true },
      ]);
    });

    it('reads a marker row without padding after the name', () => {
      expect(one('  #2     Combiner [disabled]  ')).toEqual([
        { id: 2, name: 'Combiner', enabled: false, bypassed: false },
      ]);
    });

    it('keeps other bracketed text in the name', () => {
      expect(one('  #3     Foo [1]                  ')).toEqual([
        { id: 3, name: 'Foo [1]', enabled: true, bypassed: false },
      ]);
      expect(one('  #4     Grad [frozen]            ')).toEqual([
        { id: 4, name: 'Grad [frozen]', enabled: true, bypassed: false },
      ]);
    });

    it('keeps other bracketed text in front of a known marker', () => {
      expect(one('  #4     Grad [frozen]            [disabled]')).toEqual([
        { id: 4, name: 'Grad [frozen]', enabled: false, bypassed: false },
      ]);
    });

    it.each([
      ['a repeated marker', '  #1     Gradient                 [disabled] [disabled]'],
      [
        'a repeated marker around another',
        '  #1     Gradient                 [disabled] [bypassed] [disabled]',
      ],
    ])('fails with UNEXPECTED_OUTPUT on %s', (_label, row) => {
      expect(code(() => one(row))).toBe('UNEXPECTED_OUTPUT');
    });
  });

  it.each([
    ['a missing header', ['  #1     Height Output']],
    ['a count mismatch', ['Devices (2 total):', '  #1     Height Output']],
    ['a malformed row', ['Devices (1 total):', '  Height Output']],
    ['no output', []],
  ])('fails with UNEXPECTED_OUTPUT on %s', (_label, lines) => {
    expect(code(() => parseDeviceList(lines))).toBe('UNEXPECTED_OUTPUT');
  });
});
