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
    expect(devices[0]).toEqual({ id: 1, name: 'Height Output' });
    expect(devices.find((d) => d.id === 309)).toEqual({
      id: 309,
      name: 'Colormap only',
      kind: 'Bitmap Output',
    });
    expect(devices.find((d) => d.id === 319)).toEqual({ id: 319, name: 'Easy Distortion', kind: 'Macro' });
  });

  it('keeps single-spaced parentheses inside a name', () => {
    expect(parseDeviceList(['Devices (1 total):', '  #7     My (old) Perlin         '])).toEqual([
      { id: 7, name: 'My (old) Perlin' },
    ]);
  });

  it('reads an empty project', () => {
    expect(parseDeviceList(['No devices in the current project.'])).toEqual([]);
  });

  it('accepts fewer rows than the header total when the list was filtered', () => {
    expect(parseDeviceList(['Devices (17 total):', '  #1     Height Output           '], true)).toEqual([
      { id: 1, name: 'Height Output' },
    ]);
  });

  it('still rejects more rows than the header total when filtered', () => {
    expect(code(() => parseDeviceList(['Devices (1 total):', '  #1     A', '  #2     B'], true))).toBe(
      'UNEXPECTED_OUTPUT',
    );
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
