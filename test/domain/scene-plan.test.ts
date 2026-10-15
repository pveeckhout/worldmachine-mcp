import { describe, expect, it } from 'vitest';
import type { Scene } from '../../src/domain/scene.js';
import { sceneChanges, sceneDiff, sceneMatches } from '../../src/domain/scene-plan.js';

const SCENE: Scene = {
  name: 'Main Extents',
  index: 0,
  count: 1,
  originKm: { x: 4, y: 4 },
  sizeKm: { width: 12, height: 12 },
  resolution: 2049,
  locked: false,
};

describe('sceneChanges (spec v3 revision 8)', () => {
  it('lists only the fields that differ', () => {
    expect(sceneChanges({ resolution: 1025, name: 'Main Extents' }, SCENE)).toEqual({
      resolution: { from: 2049, to: 1025 },
    });
  });

  it('compares the name with case and the resolution exactly', () => {
    expect(sceneChanges({ name: 'main extents', resolution: 2049 }, SCENE)).toEqual({
      name: { from: 'Main Extents', to: 'main extents' },
    });
  });

  it('compares the origin and the size at two decimals (fact 101)', () => {
    const shown: Scene = { ...SCENE, originKm: { x: 0.33, y: 0.34 }, sizeKm: { width: 6.13, height: 6.01 } };
    expect(
      sceneChanges({ originKm: { x: 0.33, y: 0.34 }, sizeKm: { width: 6.13, height: 6.01 } }, shown),
    ).toEqual({});
    expect(sceneChanges({ sizeKm: { width: 6.13, height: 6 } }, shown)).toEqual({
      sizeKm: { from: { width: 6.13, height: 6.01 }, to: { width: 6.13, height: 6 } },
    });
  });

  it('gives no changes when everything matches', () => {
    expect(
      sceneChanges(
        {
          name: 'Main Extents',
          originKm: { x: 4, y: 4 },
          sizeKm: { width: 12, height: 12 },
          resolution: 2049,
        },
        SCENE,
      ),
    ).toEqual({});
  });
});

describe('sceneMatches and sceneDiff (spec v3 revision 8)', () => {
  it('matches a scene that shows every target', () => {
    const changes = {
      resolution: { from: 2049, to: 513 },
      sizeKm: { from: SCENE.sizeKm, to: { width: 8, height: 8 } },
    };
    expect(sceneMatches(changes, { ...SCENE, resolution: 513, sizeKm: { width: 8, height: 8 } })).toBe(true);
    expect(sceneMatches(changes, { ...SCENE, resolution: 513 })).toBe(false);
  });

  it('diffs the fields whose value changed', () => {
    expect(sceneDiff(SCENE, { ...SCENE, resolution: 513, name: 'Probe' })).toEqual({
      name: { before: 'Main Extents', after: 'Probe' },
      resolution: { before: 2049, after: 513 },
    });
    expect(sceneDiff(SCENE, SCENE)).toEqual({});
  });
});
