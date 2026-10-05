import { lstat } from 'node:fs/promises';
import type { ProjectGraphWritePort } from '../../../application/port/out/project-graph-write-port.js';
import { WorldMachineError } from '../../../domain/errors.js';
import { buildCommand } from './command-builder.js';
import { unexpectedOutput } from './parsers/unexpected.js';
import { OPEN_FAILED, requireCreatedLine, requireOpenedLine } from './project-confirmations.js';
import { throwIfFailed } from './raw-response.js';
import type { WorldMachineSession } from './world-machine-session.js';

type FileStat = { readonly mtimeMs: number; isFile(): boolean };
type StatFile = (path: string) => Promise<FileStat | undefined>;

/** lstat, so a dangling symlink counts as present; only ENOENT means absent, any other error propagates. */
const statOrUndefined: StatFile = (path) =>
  lstat(path).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  });

export class WorldMachineProjectWriter implements ProjectGraphWritePort {
  readonly #session: WorldMachineSession;
  readonly #statFile: StatFile;

  constructor(session: WorldMachineSession, statFile: StatFile = statOrUndefined) {
    this.#session = session;
    this.#statFile = statFile;
  }

  async openProject(path: string): Promise<void> {
    // `force` discards unsaved changes without World Machine's dialog (spec fact 19); the service checked dirty.
    const response = await this.#session.executeOne(buildCommand(['project', 'open'], path, ['force']));
    throwIfFailed(response);
    if (response.output.includes(OPEN_FAILED)) {
      // A failed open leaves an empty project (spec fact 17).
      this.#session.bind({ kind: 'fresh' });
      throw new WorldMachineError(
        'WM_COMMAND_FAILED',
        `World Machine could not open ${path}; the previous project was closed`,
        OPEN_FAILED,
      );
    }
    requireOpenedLine(response, path);
    this.#session.bind({ kind: 'opened', path });
  }

  async createProject(): Promise<void> {
    const response = await this.#session.executeOne(buildCommand(['project', 'new', 'default', 'force']));
    throwIfFailed(response);
    requireCreatedLine(response);
    this.#session.bind({ kind: 'fresh' });
  }

  async saveProject(path: string, allowReplace: boolean): Promise<void> {
    if (!allowReplace && (await this.#existsOrUnusable(path))) {
      throw new WorldMachineError('REFUSED', `${path} already exists. Pass overwrite: true to replace it.`);
    }
    // Truncated to the second so filesystems with coarse timestamps still pass (spec section 7).
    const startedMs = Math.floor(Date.now() / 1000) * 1000;
    const response = await this.#session.executeOne(buildCommand(['project', 'save'], path));
    throwIfFailed(response);
    if (!response.output.includes(`Project saved to: ${path}`))
      throw unexpectedOutput('project save', response.output);
    const after = await this.#statFile(path).catch(() => undefined);
    const written = after?.isFile() && after.mtimeMs >= startedMs;
    if (!written) {
      // World Machine confirms saves it did not perform (spec fact 23).
      throw new WorldMachineError(
        'WM_COMMAND_FAILED',
        `World Machine reported saving ${path} but the file was not written`,
        response.output.join('\n') || undefined,
      );
    }
    this.#session.bind({ kind: 'opened', path });
  }

  /** Only a definite absence passes; an existing entry, or a stat failure other than ENOENT, does not (spec section 9). */
  async #existsOrUnusable(path: string): Promise<boolean> {
    try {
      return (await this.#statFile(path)) !== undefined;
    } catch {
      throw new WorldMachineError(
        'REFUSED',
        `Not a writable .tmd project path inside the allowed roots: ${path}`,
      );
    }
  }

  async undo(): Promise<void> {
    await this.#confirmed('project undo', 'Undo performed.');
    this.#session.markDirty();
  }

  async redo(): Promise<void> {
    await this.#confirmed('project redo', 'Redo performed.');
    this.#session.markDirty();
  }

  async #confirmed(command: string, confirmation: string): Promise<void> {
    const response = await this.#session.executeOne(command);
    throwIfFailed(response);
    if (!response.output.includes(confirmation)) throw unexpectedOutput(command, response.output);
  }
}
