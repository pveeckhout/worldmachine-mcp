import type { BuildResultPort } from '../../../application/port/out/build-result-port.js';
import { buildCommand } from './command-builder.js';
import { hasFinishedResults } from './parsers/device-timing.js';
import { requireFrame, throwIfFailed } from './raw-response.js';
import type { WorldMachineSession } from './world-machine-session.js';

/** Build-not-built design sections 4 step 3 and 7: `debug devicetiming #<id>` of every device, in one batch. */
export class WorldMachineBuildResultReader implements BuildResultPort {
  readonly #session: WorldMachineSession;

  constructor(session: WorldMachineSession) {
    this.#session = session;
  }

  async builtDevices(ids: readonly number[]): Promise<number[]> {
    this.#session.assertAcceptingCalls();
    if (ids.length === 0) return [];
    const responses = await this.#session.execute(
      ids.map((id) => buildCommand(['debug', 'devicetiming', `#${id}`])),
    );
    return ids.filter((id, index) => {
      const response = requireFrame(responses[index]);
      throwIfFailed(response);
      return hasFinishedResults(id, response.output);
    });
  }
}
