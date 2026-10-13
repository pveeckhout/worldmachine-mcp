import type {
  BuildStatusView,
  GetBuildStatusQuery,
  GetBuildStatusQueryPort,
  LastFullBuildView,
} from '../port/in/query/get-build-status-query.js';
import type { BuildPort } from '../port/out/build-port.js';
import type { WorldMachineSessionPort } from '../port/out/world-machine-session-port.js';
import type { BuildObservation, CheckedFullBuild, LastFullBuildRecord } from './last-full-build-record.js';
import type { OutputsChecker } from './outputs-checker.js';

/** Build-status-check design section 5: `startedAt` in ISO 8601, then the result as build_project reports it. */
function viewOf({ startedAt, result }: CheckedFullBuild): LastFullBuildView {
  return { startedAt: new Date(startedAt).toISOString(), ...result };
}

export class GetBuildStatusService implements GetBuildStatusQueryPort {
  readonly #session: WorldMachineSessionPort;
  readonly #build: BuildPort;
  readonly #lastFullBuild: LastFullBuildRecord;
  readonly #checker: OutputsChecker;

  constructor(
    session: WorldMachineSessionPort,
    build: BuildPort,
    lastFullBuild: LastFullBuildRecord,
    checker: OutputsChecker,
  ) {
    this.#session = session;
    this.#build = build;
    this.#lastFullBuild = lastFullBuild;
    this.#checker = checker;
  }

  /**
   * Never launches World Machine: `previewRunning` is false without sending anything when it is not running, and a
   * check reads only when the record's step, taken again inside its exclusive() section, is still `check`
   * (build-status-check design section 3, plan decision D7). exclusive() is taken only when a check is due (section 4).
   */
  async getBuildStatus(_query: GetBuildStatusQuery): Promise<BuildStatusView> {
    const previewRunning = await this.#build.previewRunning();
    // After `build status`, whose frame may hold the build's end (fact 47).
    const checked = await this.#lastFullBuild.resolve(
      () => this.#observe(),
      (guard) => this.#checker.checkGuarded(guard),
    );
    // Read after `build status` and the check: build events inside its frame may have ended or opened a run (fact
    // 47), and a build may have started while the check waited (plan decision D10).
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
      // Section 5: absent while a build runs (plan decision D10).
      ...(run === undefined && checked !== undefined ? { lastFullBuild: viewOf(checked) } : {}),
      session: this.#session.status().session,
    };
  }

  /** Section 3: what the record's step reads, taken once outside and again inside the check's section (D7). */
  #observe(): BuildObservation {
    const status = this.#session.status();
    return {
      last: this.#build.last(),
      generation: status.generation,
      revision: this.#session.projectRevision(),
      switches: this.#session.projectSwitches(),
      ready: status.session.state === 'ready',
    };
  }
}
