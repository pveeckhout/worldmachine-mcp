import type {
  BuildStatusView,
  GetBuildStatusQuery,
  GetBuildStatusQueryPort,
} from '../port/in/query/get-build-status-query.js';
import type { BuildPort } from '../port/out/build-port.js';
import type { WorldMachineSessionPort } from '../port/out/world-machine-session-port.js';

export class GetBuildStatusService implements GetBuildStatusQueryPort {
  readonly #session: WorldMachineSessionPort;
  readonly #build: BuildPort;

  constructor(session: WorldMachineSessionPort, build: BuildPort) {
    this.#session = session;
    this.#build = build;
  }

  /** Never launches World Machine: `previewRunning` is false without sending anything when it is not running. */
  async getBuildStatus(_query: GetBuildStatusQuery): Promise<BuildStatusView> {
    const previewRunning = await this.#build.previewRunning();
    // Read after `build status`: build events inside its frame may have ended or opened a run (fact 47).
    const run = this.#build.current();
    return {
      build:
        run === undefined
          ? null
          : {
              mode: run.mode,
              elapsedSeconds: Math.floor((Date.now() - run.startedAt) / 1_000),
              startedBy: run.startedBy,
            },
      previewRunning,
      session: this.#session.status().session,
    };
  }
}
