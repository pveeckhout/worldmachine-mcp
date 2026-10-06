import { WorldMachineError } from '../../domain/errors.js';
import {
  type CheckedExportTarget,
  type ExportTarget,
  expandTemplate,
  folderOf,
  usesTokenInFolder,
} from '../../domain/output-template.js';
import type { ExportPort } from '../port/out/export-port.js';
import type { PathPolicyPort } from '../port/out/path-policy-port.js';
import type { ProjectGraphReadPort } from '../port/out/project-graph-read-port.js';
import type { WorldMachineSessionPort } from '../port/out/world-machine-session-port.js';

export type ExportCheckPorts = {
  readonly session: WorldMachineSessionPort;
  readonly exports: ExportPort;
  readonly graph: ProjectGraphReadPort;
  readonly policy: PathPolicyPort;
};

export type ExportCheck = {
  /** The folder of the saved `.tmd` file; null for a project never saved. */
  readonly projectFolder: string | null;
  readonly targets: readonly CheckedExportTarget[];
};

/** What World Machine will write: `export all` output, or the tiles of a tiled build. */
export type OutputUse = 'export' | 'tiled';

export const NEVER_SAVED =
  'The project has never been saved, so World Machine would write into ~/Documents/WorldMachine';
// Decision D9: a tiled build names its files with the tile resolution (raw/v2-build-concurrency.txt l.173-200: `256`
// at scene resolution 4097), which the console cannot read (fact 41).
const TILED_RES_FOLDER =
  'A tiled build fills <res> with the tile resolution, which the server cannot read, and this template uses it in a folder name';

/**
 * Spec v2a section 6: every target's expanded path is checked, not only the ones World Machine will write, because
 * `export all` and a tiled build write every output (facts 48, 50). Starts World Machine if it is not running.
 */
export async function checkExportTargets(ports: ExportCheckPorts, use: OutputUse): Promise<ExportCheck> {
  await ports.session.ensureRunning();
  const binding = ports.session.status().session.binding;
  const targets = await ports.exports.targets();
  if (binding?.kind !== 'opened') {
    return {
      projectFolder: null,
      targets: targets.map((target) => ({
        device: target.device,
        template: target.template,
        path: null,
        allowed: false,
        reason: NEVER_SAVED,
      })),
    };
  }
  const { resolution } = await ports.graph.getScene();
  const checked: CheckedExportTarget[] = [];
  for (const target of targets) {
    checked.push(await checkTarget(ports.policy, target, binding.path, resolution, use));
  }
  return { projectFolder: folderOf(binding.path), targets: checked };
}

async function checkTarget(
  policy: PathPolicyPort,
  target: ExportTarget,
  projectFile: string,
  resolution: number,
  use: OutputUse,
): Promise<CheckedExportTarget> {
  // Built field by field: the optional `ambiguous` flag of a target must not reach the output.
  const base = { device: target.device, template: target.template };
  const expanded = expandTemplate(target, { projectFile, resolution });
  if (expanded.kind === 'unknown-token') {
    return {
      ...base,
      path: null,
      allowed: false,
      reason: `The template uses ${expanded.token}, whose value the server cannot know`,
    };
  }
  if (expanded.kind === 'invalid') {
    return {
      ...base,
      path: null,
      allowed: false,
      reason: `${expanded.reason.charAt(0).toUpperCase()}${expanded.reason.slice(1)}`,
    };
  }
  if (use === 'tiled' && usesTokenInFolder(target.template, 'res')) {
    return { ...base, path: expanded.path, allowed: false, reason: TILED_RES_FOLDER };
  }
  try {
    return { ...base, path: await policy.authorizeOutputPath(expanded.path), allowed: true };
  } catch (error) {
    if (!(error instanceof WorldMachineError) || error.code !== 'REFUSED') throw error;
    return { ...base, path: expanded.path, allowed: false, reason: error.message };
  }
}

/** REFUSED for a project never saved or any refused target, naming each one (spec v2a section 7). */
export function requireAllAllowed(check: ExportCheck, action: string): void {
  if (check.projectFolder === null) {
    throw new WorldMachineError(
      'REFUSED',
      `Save the project inside the allowed roots before ${action}: ${NEVER_SAVED}.`,
    );
  }
  const refused = check.targets.filter((target) => !target.allowed);
  if (refused.length > 0) {
    const named = refused.map((target) => `'${target.device}': ${target.reason ?? 'refused'}`).join('; ');
    throw new WorldMachineError('REFUSED', `Refused ${action}, because of these outputs: ${named}`);
  }
}

/** The distinct folders of the checked paths, sorted. */
export function outputFolders(check: ExportCheck): string[] {
  const folders = check.targets.flatMap((target) => (target.path === null ? [] : [folderOf(target.path)]));
  return [...new Set(folders)].sort();
}
