import { WorldMachineError } from '../../domain/errors.js';
import type { Group } from '../../domain/group.js';
import type {
  BuildProjectCommand,
  BuildProjectCommandPort,
  BuildProjectView,
} from '../port/in/command/build-project-command.js';
import { type BuildPort, GROUP_BUILD_NEEDS_GROUP } from '../port/out/build-port.js';
import type { BuildResultPort } from '../port/out/build-result-port.js';
import type { ExportPort } from '../port/out/export-port.js';
import type { GroupPort } from '../port/out/group-port.js';
import type { PathPolicyPort } from '../port/out/path-policy-port.js';
import type { ProjectGraphReadPort } from '../port/out/project-graph-read-port.js';
import type { WorldMachineSessionPort } from '../port/out/world-machine-session-port.js';
import {
  checkExportTargets,
  type ExportCheckPorts,
  outputFolders,
  requireAllAllowed,
} from './export-rules.js';
import type { LastFullBuildRecord } from './last-full-build-record.js';
import { OutputsChecker } from './outputs-checker.js';

/** Spec v2a section 4: with a progress token, the wait reports elapsed seconds every 5 s. */
export const PROGRESS_INTERVAL_MS = 5_000;

/** Spec v2b section 3: `group` is required for mode `group` and refused for the others, before anything is sent. */
function checkGroupInput(command: BuildProjectCommand): void {
  if (command.mode === 'group' && command.group === undefined) {
    throw new WorldMachineError('REFUSED', GROUP_BUILD_NEEDS_GROUP);
  }
  if (command.mode !== 'group' && command.group !== undefined) {
    throw new WorldMachineError('REFUSED', `group applies only to mode group, not to mode ${command.mode}`);
  }
}

export class BuildProjectService implements BuildProjectCommandPort {
  readonly #build: BuildPort;
  readonly #ports: ExportCheckPorts;
  readonly #groups: GroupPort;
  readonly #checker: OutputsChecker;
  readonly #lastFullBuild: LastFullBuildRecord;

  constructor(
    session: WorldMachineSessionPort,
    build: BuildPort,
    exports: ExportPort,
    graph: ProjectGraphReadPort,
    policy: PathPolicyPort,
    groups: GroupPort,
    results: BuildResultPort,
    lastFullBuild: LastFullBuildRecord,
  ) {
    this.#build = build;
    this.#ports = { session, exports, graph, policy };
    this.#groups = groups;
    this.#checker = new OutputsChecker(session, exports, graph, results);
    this.#lastFullBuild = lastFullBuild;
  }

  /** Mode `group`: the group the reference names, refused when it has no devices (decision D8). */
  async #groupToBuild(reference: string): Promise<Group> {
    const group = await this.#groups.resolve(reference);
    if (group.deviceCount === 0) {
      throw new WorldMachineError(
        'REFUSED',
        `Group #${group.index} '${group.name}' contains no devices, so there is nothing to build`,
      );
    }
    return group;
  }

  /**
   * Spec v2a section 6 (fact 55): a File Output with exportAlways set writes its file on every full build, so such a
   * build gets the export check first. A full build without one writes no files (fact 48). Assumption B5: a group
   * build may write it too, so it gets the same check.
   */
  async #checkExportAlways(mode: 'full' | 'group'): Promise<void> {
    const targets = await this.#ports.exports.targets();
    if (targets.length === 0) return;
    const always = await this.#ports.exports.exportingAlways(targets.map((target) => target.device));
    if (always.length === 0) return;
    const named = always.map((device) => `'${device}'`).join(', ');
    requireAllAllowed(
      await checkExportTargets(this.#ports, 'export'),
      `a ${mode} build that writes outputs (${named} ${always.length === 1 ? 'has' : 'have'} exportAlways set)`,
    );
  }

  async buildProject(command: BuildProjectCommand): Promise<BuildProjectView> {
    const { mode } = command;
    const { session } = this.#ports;
    checkGroupInput(command);
    // Spec v2a section 4: exclusive() only around the checks and the start, so other calls do not queue behind the
    // wait. The session refuses it while a full, tiled, or group build runs.
    const started = await session.exclusive(async () => {
      // A call cancelled while it queued for exclusive() starts nothing; it returns as a cancelled wait does.
      if (command.signal?.aborted) return undefined;
      let folders: string[] | undefined;
      // Spec v2b section 4: resolved inside the same exclusive() action that sends `group build #<index>`.
      const group = mode === 'group' ? await this.#groupToBuild(command.group ?? '') : undefined;
      if (mode === 'tiled') {
        const check = await checkExportTargets(this.#ports, 'tiled');
        requireAllAllowed(check, 'a tiled build');
        folders = outputFolders(check);
      }
      if (mode === 'full' || mode === 'group') await this.#checkExportAlways(mode);
      const requestedAt = Date.now();
      // Build-status-check design section 3: the project as the build starts; no command changes it until the build
      // ends (section 2, plan decision D4).
      const revision = session.projectRevision();
      const switches = session.projectSwitches();
      await this.#build.start(mode, group);
      // Plan decision D9: the run the record names in its World Machine process, none when no run is visible. last(),
      // not current(): a build can end inside start's own frame (fact 47), and last() still holds that ended run.
      const run = this.#build.last()?.startedAt;
      const stamp =
        run === undefined
          ? undefined
          : { startedAt: run, generation: session.status().generation, revision, switches };
      return { startedAt: run ?? requestedAt, stamp, folders, group };
    });
    if (started === undefined) {
      return { state: 'running', mode, elapsedSeconds: 0, session: session.status().session };
    }
    const { startedAt, stamp, folders, group } = started;
    const elapsedSeconds = () => Math.floor((Date.now() - startedAt) / 1_000);
    const onProgress = command.onProgress;
    const ticker =
      onProgress === undefined
        ? undefined
        : setInterval(() => onProgress(elapsedSeconds()), PROGRESS_INTERVAL_MS);
    let ended: boolean;
    try {
      ended = await this.#build.waitForEnd(mode, command.waitSeconds * 1_000, command.signal);
    } catch (error) {
      // The wait failed (for example CRASHED): the build was started, so the record names it with no result, and the
      // earlier build's result must not stand in for it (build-status-check design section 3).
      if (mode === 'full' && stamp !== undefined) this.#lastFullBuild.outlived(stamp);
      throw error;
    } finally {
      clearInterval(ticker);
    }
    // Plan decision B8: the build's seconds, before the check reads anything.
    const elapsed = elapsedSeconds();
    // Section 3: only a full build that finished within the wait is checked; a build ended by stop_build is too (B10).
    const check = ended && mode === 'full' ? await this.#checker.check() : undefined;
    // Build-status-check design section 3: the record get_build_status reports from (plan decision D9).
    if (mode === 'full' && stamp !== undefined) {
      if (check === undefined) this.#lastFullBuild.outlived(stamp);
      else this.#lastFullBuild.finished(stamp, check);
    }
    return {
      state: ended ? 'finished' : 'running',
      mode,
      elapsedSeconds: elapsed,
      ...(folders === undefined ? {} : { outputFolders: folders }),
      ...(group === undefined
        ? {}
        : { group: { index: group.index, name: group.name, deviceCount: group.deviceCount } }),
      ...check,
      session: session.status().session,
    };
  }
}
