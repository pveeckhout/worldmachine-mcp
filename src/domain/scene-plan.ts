import type { GraphScene } from './graph-spec.js';
import type { Scene } from './scene.js';

type Point = { readonly x: number; readonly y: number };
type Extent = { readonly width: number; readonly height: number };
type Step<T> = { readonly from: T; readonly to: T };
type Change<T> = { readonly before: T; readonly after: T };

/** Revision 8: the fields a `set-scene` step changes, each with the current value and the spec's. */
export type SceneStepChanges = {
  readonly name?: Step<string>;
  readonly originKm?: Step<Point>;
  readonly sizeKm?: Step<Extent>;
  readonly resolution?: Step<number>;
};

/** Revision 8: the apply result's `scene`, the fields whose value changed. */
export type SceneDiff = {
  readonly name?: Change<string>;
  readonly originKm?: Change<Point>;
  readonly sizeKm?: Change<Extent>;
  readonly resolution?: Change<number>;
};

// Fact 101: World Machine shows origin and size with two decimals, so they are compared in hundredths.
const hundredths = (value: number): number => Math.round(value * 100);
const samePoint = (a: Point, b: Point): boolean =>
  hundredths(a.x) === hundredths(b.x) && hundredths(a.y) === hundredths(b.y);
const sameExtent = (a: Extent, b: Extent): boolean =>
  hundredths(a.width) === hundredths(b.width) && hundredths(a.height) === hundredths(b.height);

/** Revision 8: the fields of `wanted` that differ from `current`; the name with case, the resolution exactly. */
export function sceneChanges(wanted: GraphScene, current: Scene): SceneStepChanges {
  const { name, originKm, sizeKm, resolution } = wanted;
  return {
    ...(name === undefined || name === current.name ? {} : { name: { from: current.name, to: name } }),
    ...(originKm === undefined || samePoint(originKm, current.originKm)
      ? {}
      : { originKm: { from: current.originKm, to: originKm } }),
    ...(sizeKm === undefined || sameExtent(sizeKm, current.sizeKm)
      ? {}
      : { sizeKm: { from: current.sizeKm, to: sizeKm } }),
    ...(resolution === undefined || resolution === current.resolution
      ? {}
      : { resolution: { from: current.resolution, to: resolution } }),
  };
}

/** The values a `set-scene` step sets, in the shape `SceneEditPort.configureScene` takes. */
export function sceneTargets(changes: SceneStepChanges): GraphScene {
  return {
    ...(changes.name === undefined ? {} : { name: changes.name.to }),
    ...(changes.originKm === undefined ? {} : { originKm: changes.originKm.to }),
    ...(changes.sizeKm === undefined ? {} : { sizeKm: changes.sizeKm.to }),
    ...(changes.resolution === undefined ? {} : { resolution: changes.resolution.to }),
  };
}

/** True when `scene` shows every value the step set, compared as the plan compares. */
export function sceneMatches(changes: SceneStepChanges, scene: Scene): boolean {
  return Object.keys(sceneChanges(sceneTargets(changes), scene)).length === 0;
}

/** Revision 8: the fields whose value differs between the scene before the apply and the one the step returned. */
export function sceneDiff(before: Scene, after: Scene): SceneDiff {
  const changed = sceneChanges(
    { name: after.name, originKm: after.originKm, sizeKm: after.sizeKm, resolution: after.resolution },
    before,
  );
  return {
    ...(changed.name === undefined ? {} : { name: { before: changed.name.from, after: changed.name.to } }),
    ...(changed.originKm === undefined
      ? {}
      : { originKm: { before: changed.originKm.from, after: changed.originKm.to } }),
    ...(changed.sizeKm === undefined
      ? {}
      : { sizeKm: { before: changed.sizeKm.from, after: changed.sizeKm.to } }),
    ...(changed.resolution === undefined
      ? {}
      : { resolution: { before: changed.resolution.from, after: changed.resolution.to } }),
  };
}
