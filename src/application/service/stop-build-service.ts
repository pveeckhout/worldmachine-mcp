import { WorldMachineError } from '../../domain/errors.js';
import type {
  StopBuildCommand,
  StopBuildCommandPort,
  StopBuildView,
} from '../port/in/command/stop-build-command.js';
import type { BuildPort } from '../port/out/build-port.js';
import type { WorldMachineSessionPort } from '../port/out/world-machine-session-port.js';

/** Spec v2a section 4: a run that does not end within 10 s of `build stop` is WM_COMMAND_FAILED. */
export const STOP_WAIT_MS = 10_000;

export class StopBuildService implements StopBuildCommandPort {
  readonly #session: WorldMachineSessionPort;
  readonly #build: BuildPort;

  constructor(session: WorldMachineSessionPort, build: BuildPort) {
    this.#session = session;
    this.#build = build;
  }

  /** Not inside exclusive(): the session refuses exclusive actions while a build runs (decision D6). */
  async stopBuild(_command: StopBuildCommand): Promise<StopBuildView> {
    // A build_project start still waiting for its opening event would read as no build (fact 44).
    await this.#build.awaitStart();
    const run = this.#build.current();
    if (run !== undefined) {
      await this.#build.stop();
      if (!(await this.#build.waitForEnd(run.mode, STOP_WAIT_MS))) {
        const what = run.mode === 'unknown' ? 'build started in World Machine' : `${run.mode} build`;
        const failed = `The ${what} did not end within ${STOP_WAIT_MS / 1_000} s of build stop`;
        if (run.startedBy === 'world-machine') {
          // Spec v2a section 4: a run World Machine started may rest on a stray event; dropping it keeps the change
          // tools from being refused until World Machine restarts.
          this.#build.forgetRun();
          throw new WorldMachineError('WM_COMMAND_FAILED', `${failed}; the server no longer tracks it`);
        }
        throw new WorldMachineError('WM_COMMAND_FAILED', failed);
      }
      return this.#view(run.mode);
    }
    if (!(await this.#build.previewRunning())) return this.#view(null);
    await this.#build.stop();
    // Fact 46: status reads `No build running.` right after a stopped preview.
    if (await this.#build.previewRunning()) {
      throw new WorldMachineError('WM_COMMAND_FAILED', 'The preview was still running after build stop');
    }
    return this.#view('preview');
  }

  #view(stopped: StopBuildView['stopped']): StopBuildView {
    return { stopped, session: this.#session.status().session };
  }
}
