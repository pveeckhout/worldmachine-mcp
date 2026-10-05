import type { SceneChanges } from '../../../domain/graph-edit.js';
import type { Scene } from '../../../domain/scene.js';

/** Scene configuration (spec section 7). Returns `scene show` after the change. Run inside `exclusive`. */
export interface SceneEditPort {
  configureScene(changes: SceneChanges): Promise<Scene>;
}
