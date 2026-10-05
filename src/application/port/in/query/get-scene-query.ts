import type { Scene } from '../../../../domain/scene.js';
import type { SessionSummary } from '../../../../domain/session.js';

export type GetSceneQuery = Readonly<Record<string, never>>;
export type SceneView = { readonly scene: Scene; readonly session: SessionSummary };
export interface GetSceneQueryPort {
  getScene(query: GetSceneQuery): Promise<SceneView>;
}
