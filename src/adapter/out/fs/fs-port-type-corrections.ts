import { mkdirSync, readdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { PortTypeCorrectionsPort } from '../../../application/port/out/port-type-corrections-port.js';
import type { RecordPortTypeCorrectionPort } from '../../../application/port/out/record-port-type-correction-port.js';
import type { RetirePortTypeCorrectionsPort } from '../../../application/port/out/retire-port-type-corrections-port.js';
import {
  correctionIndex,
  type PortRef,
  type PortTypeCorrection,
  portKey,
  type VerdictSource,
  type WireVerdict,
} from '../../../domain/catalog.js';
import type { Logger } from '../../../logger.js';
import { writeFileAtomic } from './atomic-write.js';

const FILE = 'port-type-corrections.json';
const VERDICTS: readonly string[] = ['accepted', 'refused'] satisfies WireVerdict[];
const SOURCES: readonly string[] = ['apply_graph', 'connect_devices'] satisfies VerdictSource[];

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** `Type.Port`, split on the first dot: a device type never contains one, a port name may (`Add Output...`). */
function parseRef(value: unknown): PortRef {
  if (typeof value !== 'string' || !value.includes('.')) {
    throw new Error(`bad port key ${JSON.stringify(value)}`);
  }
  const dot = value.indexOf('.');
  const ref = { type: value.slice(0, dot), port: value.slice(dot + 1) };
  if (ref.type === '' || ref.port === '') throw new Error(`bad port key ${JSON.stringify(value)}`);
  return ref;
}

function parseFile(json: unknown, build: number): PortTypeCorrection[] {
  const file = json as { build?: unknown; corrections?: unknown } | null;
  if (typeof file !== 'object' || file === null) throw new Error('not an object');
  if (file.build !== build) throw new Error(`build ${String(file.build)} in a folder for build ${build}`);
  if (!Array.isArray(file.corrections)) throw new Error('corrections is not an array');
  return file.corrections.map((raw: unknown, i) => {
    const entry = raw as Record<string, unknown> | null;
    if (typeof entry !== 'object' || entry === null) throw new Error(`correction ${i} is not an object`);
    const { verdict, source, at } = entry;
    if (typeof verdict !== 'string' || !VERDICTS.includes(verdict)) {
      throw new Error(`correction ${i} has verdict ${JSON.stringify(verdict)}`);
    }
    if (typeof source !== 'string' || !SOURCES.includes(source)) {
      throw new Error(`correction ${i} has source ${JSON.stringify(source)}`);
    }
    if (typeof at !== 'string') throw new Error(`correction ${i} has no timestamp`);
    return {
      build,
      output: parseRef(entry.output),
      input: parseRef(entry.input),
      verdict: verdict as WireVerdict,
      source: source as VerdictSource,
      at,
    };
  });
}

/** `<directory>/<build>/port-type-corrections.json`, loaded at construction, rewritten whole on each record. */
export class FsPortTypeCorrections
  implements RecordPortTypeCorrectionPort, PortTypeCorrectionsPort, RetirePortTypeCorrectionsPort
{
  readonly #directory: string;
  readonly #logger: Logger;
  readonly #entries = new Map<number, PortTypeCorrection[]>();
  readonly #failed = new Map<number, string>();
  readonly #problems: string[] = [];
  #directoryFailure: string | undefined;

  constructor(directory: string, logger: Logger) {
    this.#directory = directory;
    this.#logger = logger;
    for (const name of this.#builds()) {
      const path = join(directory, name, FILE);
      const build = Number(name);
      try {
        this.#entries.set(build, parseFile(JSON.parse(readFileSync(path, 'utf8')), build));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        this.#failed.set(build, path);
        this.#problems.push(`${path}: ${message(error)}`);
      }
    }
  }

  correctionsFor(build: number): ReadonlyMap<string, WireVerdict> | undefined {
    const entries = this.#entries.get(build);
    return entries === undefined ? undefined : correctionIndex(entries);
  }

  problems(): readonly string[] {
    return this.#problems;
  }

  retire(build: number): void {
    const folder = join(this.#directory, String(build));
    try {
      renameSync(join(folder, FILE), join(folder, 'port-type-corrections.previous.json'));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error;
    }
    this.#entries.delete(build);
    this.#failed.delete(build);
    const prefix = `${folder}${sep}`;
    for (let i = this.#problems.length - 1; i >= 0; i -= 1) {
      if (this.#problems[i]?.startsWith(prefix)) this.#problems.splice(i, 1);
    }
  }

  record(correction: PortTypeCorrection): void {
    const { build } = correction;
    const folder = join(this.#directory, String(build));
    const path = join(folder, FILE);
    if (this.#directoryFailure !== undefined) {
      throw new Error(
        `port-type corrections for build ${build} were not loaded: ${this.#directoryFailure}; fix or move the file`,
      );
    }
    if (this.#failed.has(build)) {
      throw new Error(
        `port-type corrections for build ${build} were not loaded: ${this.#failed.get(build)}; fix or move the file`,
      );
    }
    // The file on disk is the authority: another process or a hand edit may have changed it since startup.
    const next = [...this.#readFromDisk(build, path), correction];
    mkdirSync(folder, { recursive: true });
    const text = `${JSON.stringify(
      {
        build,
        corrections: next.map((c) => ({
          output: portKey(c.output),
          input: portKey(c.input),
          verdict: c.verdict,
          source: c.source,
          at: c.at,
        })),
      },
      null,
      2,
    )}\n`;
    writeFileAtomic(path, text);
    this.#entries.set(build, next);
    this.#logger.info(
      `port-type correction: build ${build}, ${portKey(correction.output)} -> ${portKey(correction.input)} ${correction.verdict} (${correction.source})`,
    );
  }

  /** The build's entries as the file holds them now; no file is an empty list, anything unreadable throws. */
  #readFromDisk(build: number, path: string): PortTypeCorrection[] {
    try {
      return parseFile(JSON.parse(readFileSync(path, 'utf8')), build);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') return [];
      throw new Error(
        `port-type corrections for build ${build} were not loaded: ${path}; fix or move the file`,
      );
    }
  }

  #builds(): string[] {
    try {
      return readdirSync(this.#directory)
        .filter((name) => /^\d+$/.test(name) && String(Number(name)) === name)
        .filter((name) => this.#isFolder(name))
        .sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.#directoryFailure = this.#directory;
        this.#problems.push(`${this.#directory}: ${message(error)}`);
      }
      return [];
    }
  }

  /** Follows symlinks; a stat error other than ENOENT marks the build failed, so a record cannot overwrite it. */
  #isFolder(name: string): boolean {
    const path = join(this.#directory, name);
    try {
      return statSync(path).isDirectory();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.#failed.set(Number(name), path);
        this.#problems.push(`${path}: ${message(error)}`);
      }
      return false;
    }
  }
}
