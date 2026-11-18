import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PortTypeCorrectionsPort } from '../../../application/port/out/port-type-corrections-port.js';
import type { RecordPortTypeCorrectionPort } from '../../../application/port/out/record-port-type-correction-port.js';
import {
  correctionIndex,
  type PortRef,
  type PortTypeCorrection,
  pairKey,
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

/** `Type.Port` with exactly one dot; the device type never contains one, the port name may contain spaces. */
function parseRef(value: unknown): PortRef {
  if (typeof value !== 'string' || value.split('.').length !== 2) {
    throw new Error(`bad port key ${JSON.stringify(value)}`);
  }
  const dot = value.indexOf('.');
  return { type: value.slice(0, dot), port: value.slice(dot + 1) };
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
export class FsPortTypeCorrections implements RecordPortTypeCorrectionPort, PortTypeCorrectionsPort {
  readonly #directory: string;
  readonly #logger: Logger;
  readonly #entries = new Map<number, PortTypeCorrection[]>();
  readonly #failed = new Map<number, string>();
  readonly #problems: string[] = [];

  constructor(directory: string, logger: Logger) {
    this.#directory = directory;
    this.#logger = logger;
    for (const name of this.#builds()) {
      const path = join(directory, name, FILE);
      if (!existsSync(path)) continue;
      const build = Number(name);
      try {
        this.#entries.set(build, parseFile(JSON.parse(readFileSync(path, 'utf8')), build));
      } catch (error) {
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

  record(correction: PortTypeCorrection): void {
    const { build } = correction;
    const folder = join(this.#directory, String(build));
    const path = join(folder, FILE);
    if (this.#failed.has(build)) {
      throw new Error(
        `port-type corrections for build ${build} were not loaded: ${this.#failed.get(build)}; fix or move the file`,
      );
    }
    const next = [...(this.#entries.get(build) ?? []), correction];
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
      `port-type correction: build ${build}, ${pairKey(correction.output, correction.input).replace('->', ' -> ')} ${correction.verdict} (${correction.source})`,
    );
  }

  #builds(): string[] {
    try {
      return readdirSync(this.#directory, { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isDirectory() && /^\d+$/.test(entry.name) && String(Number(entry.name)) === entry.name,
        )
        .map((entry) => entry.name)
        .sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.#problems.push(`${this.#directory}: ${message(error)}`);
      }
      return [];
    }
  }
}
