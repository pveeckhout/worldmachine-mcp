import type { BuildResultPort } from '../../../application/port/out/build-result-port.js';
import { buildCommand } from './command-builder.js';
import { isBuiltAtResolution } from './parsers/device-timing.js';
import { parseSceneShow } from './parsers/scene.js';
import { requireFrame, throwIfFailed } from './raw-response.js';
import type { WorldMachineSession } from './world-machine-session.js';

/**
 * Build-not-built design sections 4 step 2 and 7: `scene show` for the resolution and `debug devicetiming #<id>` of
 * every device, in one batch (fact 95).
 */
export class WorldMachineBuildResultReader implements BuildResultPort {
  readonly #session: WorldMachineSession;

  constructor(session: WorldMachineSession) {
    this.#session = session;
  }

  async builtDevices(ids: readonly number[]): Promise<number[]> {
    this.#session.assertAcceptingCalls();
    if (ids.length === 0) return [];
    const responses = await this.#session.execute([
      buildCommand(['scene', 'show']),
      ...ids.map((id) => buildCommand(['debug', 'devicetiming', `#${id}`])),
    ]);
    const sceneResponse = requireFrame(responses[0]);
    throwIfFailed(sceneResponse);
    const { resolution } = parseSceneShow(sceneResponse.output);
    return ids.filter((id, index) => {
      const response = requireFrame(responses[index + 1]);
      throwIfFailed(response);
      return isBuiltAtResolution(id, response.output, resolution);
    });
  }
}
