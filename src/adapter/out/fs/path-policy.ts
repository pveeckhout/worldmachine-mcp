import type { Stats } from 'node:fs';
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
    requirePlainProjectName(resolved);
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
    requirePlainProjectName(input);
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

  async authorizeOutputPath(input: string): Promise<string> {
    const canonicalRoots = await this.#canonicalRoots();
    if (!path.isAbsolute(input))
      throw new WorldMachineError('REFUSED', `Output paths must be absolute: ${input}`);
    // Physical resolution of '..' behind a symlink differs from lexical normalisation, so only plain paths pass.
    if (path.normalize(input) !== input || (input.length > 1 && input.endsWith(path.sep))) {
      throw new WorldMachineError(
        'REFUSED',
        `The output path ${input} must be a plain absolute path without '.', '..', or repeated or trailing slashes.`,
      );
    }
    const folder = path.dirname(input);
    // Spec v2a section 5: World Machine's handling of a missing folder is unknown (fact 23 shows a save into one
    // failing silently), so a missing folder is refused, not created.
    const directory = await canonicalDirectory(folder);
    if (directory === null)
      throw new WorldMachineError('REFUSED', `The output folder does not exist: ${folder}`);
    if (!canonicalRoots.some((root) => directory === root || isInside(directory, root))) {
      throw new WorldMachineError('REFUSED', `The output folder is outside the allowed roots: ${folder}`);
    }
    const target = path.join(directory, path.basename(input));
    let stats: Stats;
    try {
      stats = await lstat(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return target;
      throw new WorldMachineError('REFUSED', `The output path cannot be checked: ${target}`);
    }
    // A symlink would let World Machine write outside the roots; a directory cannot be written as a file.
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new WorldMachineError('REFUSED', `The output path exists and is not a regular file: ${target}`);
    }
    if (stats.nlink > 1) {
      throw new WorldMachineError('REFUSED', `The output path ${target} is a file with several hard links.`);
    }
    return target;
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

/** A stem of `.` or `..` would make `<project>` expand to a dot segment in an output template. */
function requirePlainProjectName(file: string): void {
  const name = path.basename(file);
  const stem = path.basename(name, path.extname(name));
  if (stem === '.' || stem === '..') {
    throw new WorldMachineError('REFUSED', `The project file name ${name} is not allowed.`);
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
