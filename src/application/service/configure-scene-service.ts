import type {
  ConfigureSceneCommand,
  ConfigureSceneCommandPort,
  ConfigureSceneView,
} from '../port/in/command/configure-scene-command.js';
import type { SceneEditPort } from '../port/out/scene-edit-port.js';
import type { WorldMachineSessionPort } from '../port/out/world-machine-session-port.js';

export class ConfigureSceneService implements ConfigureSceneCommandPort {
  readonly #session: WorldMachineSessionPort;
  readonly #scene: SceneEditPort;

  constructor(session: WorldMachineSessionPort, scene: SceneEditPort) {
    this.#session = session;
    this.#scene = scene;
  }

  configureScene(command: ConfigureSceneCommand): Promise<ConfigureSceneView> {
    return this.#session.exclusive(async () => {
      const scene = await this.#scene.configureScene(command);
      return { scene, session: this.#session.status().session };
    });
  }
}
