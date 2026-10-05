import { lstat, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { PathPolicyPort, SaveTarget } from '../../../application/port/out/path-policy-port.js';
import { WorldMachineError } from '../../../domain/errors.js';

export class FsPathPolicy implements PathPolicyPort {
  readonly #roots: readonly string[] | null;

  constructor(roots: readonly string[] | null) {
    this.#roots = roots;
  }

  async authorizeExistingProject(input: string): Promise<string> {
    const canonicalRoots = await this.#canonicalRoots();
    if (!path.isAbsolute(input))
      throw new WorldMachineError('REFUSED', `Project paths must be absolute: ${input}`);
    let resolved: string;
    try {
      resolved = await realpath(input);
    } catch {
      throw new WorldMachineError(
        'REFUSED',
        `Not an existing .tmd project file inside the allowed roots: ${input}`,
      );
    }
    if (!canonicalRoots.some((root) => isInside(resolved, root))) {
      throw new WorldMachineError(
        'REFUSED',
        `Not an existing .tmd project file inside the allowed roots: ${input}`,
      );
    }
    try {
      const stats = await stat(resolved);
      if (path.extname(resolved).toLowerCase() !== '.tmd' || !stats.isFile()) {
        throw new WorldMachineError(
          'REFUSED',
          `Not an existing .tmd project file inside the allowed roots: ${input}`,
        );
      }
    } catch (error) {
      if (error instanceof WorldMachineError) throw error;
      throw new WorldMachineError(
        'REFUSED',
        `Not an existing .tmd project file inside the allowed roots: ${input}`,
      );
    }
    return resolved;
  }

  async authorizeSaveTarget(input: string): Promise<SaveTarget> {
    const refused = new WorldMachineError(
      'REFUSED',
      `Not a writable .tmd project path inside the allowed roots: ${input}`,
    );
    const canonicalRoots = await this.#canonicalRoots();
    if (!path.isAbsolute(input) || path.extname(input).toLowerCase() !== '.tmd') throw refused;
    let directory: string;
    try {
      directory = await realpath(path.dirname(input));
    } catch {
      throw refused;
    }
    if (!canonicalRoots.some((root) => directory === root || isInside(directory, root))) throw refused;
    const target = path.join(directory, path.basename(input));
    try {
      const stats = await lstat(target);
      if (!stats.isFile() || stats.isSymbolicLink()) throw refused;
      return { path: target, exists: true };
    } catch (error) {
      if (error === refused) throw error;
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { path: target, exists: false };
      throw refused;
    }
  }

  async #canonicalRoots(): Promise<string[]> {
    const roots = this.#requireRoots();
    // A root must be an existing directory: a file can contain no project, so it does not count as configured.
    const canonical = (await Promise.all(roots.map(canonicalDirectory))).filter(
      (root): root is string => root !== null,
    );
    if (canonical.length === 0) {
      throw new WorldMachineError(
        'NOT_CONFIGURED',
        'None of the allowed project roots in WORLD_MACHINE_ALLOWED_ROOTS is an existing directory',
      );
    }
    return canonical;
  }

  #requireRoots(): readonly string[] {
    if (this.#roots === null) {
      throw new WorldMachineError(
        'NOT_CONFIGURED',
        'No allowed project roots. Set WORLD_MACHINE_ALLOWED_ROOTS, or start the server from a project directory other than / or your home directory.',
      );
    }
    return this.#roots;
  }
}

function isInside(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

async function canonicalDirectory(root: string): Promise<string | null> {
  try {
    const canonical = await realpath(root);
    return (await stat(canonical)).isDirectory() ? canonical : null;
  } catch {
    return null;
  }
}
