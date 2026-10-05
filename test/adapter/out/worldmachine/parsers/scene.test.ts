import { describe, expect, it } from 'vitest';
import { parseSceneList, parseSceneShow } from '../../../../../src/adapter/out/worldmachine/parsers/scene.js';
import { codeOf, fixtureLines } from './fixture.js';

describe('parseSceneShow', () => {
  it('reads the current scene', () => {
    expect(parseSceneShow(fixtureLines('scene-show.txt'))).toEqual({
      name: 'Main Extents',
      index: 0,
      count: 1,
      originKm: { x: 4, y: 4 },
      sizeKm: { width: 12, height: 12 },
      resolution: 2049,
      locked: false,
    });
  });

  it('fails on a malformed number', () => {
    const lines = fixtureLines('scene-show.txt').map((line) => line.replace('4.00, 4.00', '1.2.3, 4.00'));
    expect(lines).not.toEqual(fixtureLines('scene-show.txt'));
    expect(codeOf(() => parseSceneShow(lines))).toBe('UNEXPECTED_OUTPUT');
  });

  it('fails on missing lines', () => {
    expect(codeOf(() => parseSceneShow(["Scene 'A' (index 0 of 1):"]))).toBe('UNEXPECTED_OUTPUT');
  });
});

describe('parseSceneList', () => {
  it('reads scenes and marks the current one', () => {
    expect(parseSceneList(fixtureLines('scene-list.txt'))).toEqual([
      { index: 0, name: 'Main Extents', widthKm: 12, heightKm: 12, resolution: 2049, current: true },
    ]);
  });

  it('fails on a count mismatch', () => {
    expect(codeOf(() => parseSceneList(['Scenes (2 total):', "  [0] 'A' - 1.0x1.0 km, res 513 *"]))).toBe(
      'UNEXPECTED_OUTPUT',
    );
  });
});
