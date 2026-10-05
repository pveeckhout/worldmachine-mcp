import type { DeviceSummary } from './device.js';
import type { Group } from './group.js';
import type { Scene, SceneSummary } from './scene.js';

export type ProjectOverview = {
  readonly scene: Scene;
  readonly scenes: readonly SceneSummary[];
  readonly deviceCount: number;
  readonly devices: readonly DeviceSummary[];
  readonly groups: readonly Group[];
};
