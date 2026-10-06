import type {
  BuildProjectCommand,
  BuildProjectCommandPort,
  BuildProjectView,
} from '../port/in/command/build-project-command.js';
import type { BuildPort } from '../port/out/build-port.js';
import type { ExportPort } from '../port/out/export-port.js';
import type { PathPolicyPort } from '../port/out/path-policy-port.js';
import type { ProjectGraphReadPort } from '../port/out/project-graph-read-port.js';
import type { WorldMachineSessionPort } from '../port/out/world-machine-session-port.js';
import {
  checkExportTargets,
  type ExportCheckPorts,
  outputFolders,
  requireAllAllowed,
} from './export-rules.js';

/** Spec v2a section 4: with a progress token, the wait reports elapsed seconds every 5 s. */
export const PROGRESS_INTERVAL_MS = 5_000;

export class BuildProjectService implements BuildProjectCommandPort {
  readonly #build: BuildPort;
  readonly #ports: ExportCheckPorts;

  constructor(
    session: WorldMachineSessionPort,
    build: BuildPort,
    exports: ExportPort,
    graph: ProjectGraphReadPort,
    policy: PathPolicyPort,
  ) {
    this.#build = build;
    this.#ports = { session, exports, graph, policy };
  }

  async buildProject(command: BuildProjectCommand): Promise<BuildProjectView> {
    const { mode } = command;
    const { session } = this.#ports;
    // Spec v2a section 4: exclusive() only around the checks and the start, so other calls do not queue behind the
    // wait. The session refuses it while a full or tiled build runs.
    const { startedAt, folders } = await session.exclusive(async () => {
      let folders: string[] | undefined;
      if (mode === 'tiled') {
        const check = await checkExportTargets(this.#ports, 'tiled');
        requireAllAllowed(check, 'a tiled build');
        folders = outputFolders(check);
      }
      const requestedAt = Date.now();
      await this.#build.start(mode);
      return { startedAt: this.#build.current()?.startedAt ?? requestedAt, folders };
    });
    const elapsedSeconds = () => Math.floor((Date.now() - startedAt) / 1_000);
    const onProgress = command.onProgress;
    const ticker =
      onProgress === undefined
        ? undefined
        : setInterval(() => onProgress(elapsedSeconds()), PROGRESS_INTERVAL_MS);
    let ended: boolean;
    try {
      ended = await this.#build.waitForEnd(mode, command.waitSeconds * 1_000, command.signal);
    } finally {
      clearInterval(ticker);
    }
    return {
      state: ended ? 'finished' : 'running',
      mode,
      elapsedSeconds: elapsedSeconds(),
      ...(folders === undefined ? {} : { outputFolders: folders }),
      session: session.status().session,
    };
  }
}
