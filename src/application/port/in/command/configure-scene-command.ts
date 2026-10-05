import type { SceneChanges } from '../../../../domain/graph-edit.js';
import type { Scene } from '../../../../domain/scene.js';
import type { SessionSummary } from '../../../../domain/session.js';

export type ConfigureSceneCommand = SceneChanges;
export type ConfigureSceneView = { readonly scene: Scene; readonly session: SessionSummary };
export interface ConfigureSceneCommandPort {
  configureScene(command: ConfigureSceneCommand): Promise<ConfigureSceneView>;
}
