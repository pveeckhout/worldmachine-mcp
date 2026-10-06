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

  /**
   * Spec v2a section 6 (fact 55): a File Output with exportAlways set writes its file on every full build, so such a
   * build gets the export check first. A full build without one writes no files (fact 48).
   */
  async #checkExportAlways(): Promise<void> {
    const targets = await this.#ports.exports.targets();
    if (targets.length === 0) return;
    const always = await this.#ports.exports.exportingAlways(targets.map((target) => target.device));
    if (always.length === 0) return;
    const named = always.map((device) => `'${device}'`).join(', ');
    requireAllAllowed(
      await checkExportTargets(this.#ports, 'export'),
      `a full build that writes outputs (${named} ${always.length === 1 ? 'has' : 'have'} exportAlways set)`,
    );
  }

  async buildProject(command: BuildProjectCommand): Promise<BuildProjectView> {
    const { mode } = command;
    const { session } = this.#ports;
    // Spec v2a section 4: exclusive() only around the checks and the start, so other calls do not queue behind the
    // wait. The session refuses it while a full or tiled build runs.
    const started = await session.exclusive(async () => {
      // A call cancelled while it queued for exclusive() starts nothing; it returns as a cancelled wait does.
      if (command.signal?.aborted) return undefined;
      let folders: string[] | undefined;
      if (mode === 'tiled') {
        const check = await checkExportTargets(this.#ports, 'tiled');
        requireAllAllowed(check, 'a tiled build');
        folders = outputFolders(check);
      }
      if (mode === 'full') await this.#checkExportAlways();
      const requestedAt = Date.now();
      await this.#build.start(mode);
      return { startedAt: this.#build.current()?.startedAt ?? requestedAt, folders };
    });
    if (started === undefined) {
      return { state: 'running', mode, elapsedSeconds: 0, session: session.status().session };
    }
    const { startedAt, folders } = started;
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
