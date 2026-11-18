// The catalog capture the server runs (plan 3 task 9): the `enumOptions` and `portTypes` scenarios of
// scripts/capture-fixtures.mjs on a session lease, with device type discovery first. Every phase appends to its own
// transcript in the working folder as it goes, so a cancelled or crashed run is resumed by the next run of the same
// build and mode. The server never restarts World Machine inside a run: a crash ends the run (no MAX_RESTARTS).
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { DiscardCaptureTranscriptPort } from '../../../../application/port/out/discard-capture-transcript-port.js';
import type { ConsoleReply, SessionLease } from '../../../../application/port/out/lease-session-port.js';
import type {
  CaptureResult,
  CaptureRun,
  RunCatalogCapturePort,
} from '../../../../application/port/out/run-catalog-capture-port.js';
import type { DeviceDiscovery, PortTypeCatalog, SampleCheck } from '../../../../domain/catalog.js';
import type { CaptureMode, CapturePhase, CaptureProgress } from '../../../../domain/catalog-capture.js';
import { WorldMachineError } from '../../../../domain/errors.js';
import { writeFileAtomic } from '../../fs/atomic-write.js';
import { discoverDeviceTypes } from './discovery.js';
import { parseEnumCapture } from './enum-catalog.js';
import { ADD_BY_NAME, ENUM_TYPES } from './enum-words.js';
import { checkSample, nameClasses, parsePortTypeCatalog } from './port-type-catalog.js';
import {
  CRASHED,
  crashedTarget,
  type ProbeSource,
  type ProbeTarget,
  probeCommands,
  probeVerdict,
  readProbeWireList,
} from './port-type-probe.js';
import { buildOfSystemInfo, render, type Section, transcriptSections } from './transcript.js';
import { DEVICE_ROW } from './wire-list.js';

export type CapturerOptions = {
  /** Recorded in `resume.json`. */
  readonly serverVersion: string;
  readonly now?: () => Date;
};

/**
 * The format of the working folder's transcripts and markers. Raise it whenever a marker or verdict line changes: a
 * folder of another format is set aside, not resumed. The server version is recorded but never compared.
 */
export const TRANSCRIPT_FORMAT = 1;

type ResumeFile = {
  readonly build: number;
  readonly mode: CaptureMode;
  readonly serverVersion: string;
  readonly transcriptFormat: number;
};

/** A `device list` row with its listed type (fact 81: the kind, or else the name). */
type Row = { readonly id: number; readonly name: string; readonly type: string };

/** A device of the port-type phase, with its port numbers once its `wire list` was read. */
type PortDevice = Row & { readonly word: string; inputs: number[]; outputs: number[] };
type Twin = { readonly of: PortDevice; readonly id: number; inputs: number[]; outputs: number[] };

/** What the port-type phase's setup left in the project, recorded or read back from the transcript. */
type Setup = {
  /** Every word the setup added, in order, including the ones that added nothing. */
  readonly words: readonly string[];
  /** The device list after the last add. */
  readonly rows: readonly Row[];
  /** The first device of each listed type, in add order. */
  readonly probed: readonly PortDevice[];
  /** full only: the words of the twin pass, in order, and the twins it added. */
  readonly twinWords: readonly string[];
  readonly twins: readonly Twin[];
};

type Unit = {
  readonly source: ProbeSource;
  readonly lean: boolean;
  readonly targets: readonly ProbeTarget[];
};

// enum-catalog.ts PARAM_ROW and RANGE (facts 84 and 86).
const PARAM_ROW = /^\s{2}(\S(?:.*?\S)??)\s{2,}(\S+)(?:\s+(.*?))?\s*$/;
const RANGE = /^Error: Error: Enum index out of range \(0-(-1|\d+)\): 9999$/;
const AMBIGUOUS_ADD = /matches multiple devices/;
const ENUM_UNIT = /^\(enum (.+)\)$/;
const PROBE = /^\(probe #(\d+)\.(\d+)\)$/;
const SUSPECT = /^\(suspect #(\d+)\.(\d+)\)$/;
const TWIN = /^\(twin #(\d+) #(\d+)\)$/;
const VERDICT = /^#(\d+)\.(\d+) /;
const SETUP_COMPLETE = '(setup complete)';
const NOT_ADDED = 'not added';
const NO_RANGE = 'no range error';

const linesOf = (reply: ConsoleReply | undefined): string[] =>
  reply === undefined ? [] : [...reply.output, ...reply.errors];

function rowsOf(lines: readonly string[]): Row[] {
  return lines.flatMap((line) => {
    const match = DEVICE_ROW.exec(line);
    return match
      ? [{ id: Number(match[1]), name: match[2] as string, type: (match[3] ?? match[2]) as string }]
      : [];
  });
}

/** The first device of each listed type, in add order (Codex round 1 ruling B1 addendum). */
const firstOfEachType = (devices: readonly PortDevice[]): PortDevice[] =>
  devices.filter((device, index) => devices.findIndex((other) => other.type === device.type) === index);

const pairKey = (source: ProbeSource, target: { id: number; port: number }): string =>
  `${source.id}.${source.port}>${target.id}.${target.port}`;

const hasCode = (error: unknown, code: 'CRASHED' | 'TIMEOUT'): boolean =>
  error instanceof WorldMachineError && error.code === code;

/** Moves a working folder aside as `<folder>.stale-<stamp>` and returns the new path. */
function setAside(workDir: string, stamp: string): string {
  const aside = join(dirname(workDir), `${basename(workDir)}.stale-${stamp}`);
  renameSync(workDir, aside);
  return aside;
}

export class WorldMachineCatalogCapturer implements RunCatalogCapturePort, DiscardCaptureTranscriptPort {
  readonly #serverVersion: string;
  readonly #now: () => Date;

  constructor(options: CapturerOptions) {
    this.#serverVersion = options.serverVersion;
    this.#now = options.now ?? (() => new Date());
  }

  async run(
    run: CaptureRun,
    lease: SessionLease,
    onProgress: (progress: CaptureProgress) => void,
    signal: AbortSignal,
  ): Promise<CaptureResult> {
    this.#prepare(run);
    const capture = new Capture(run, lease, onProgress, signal, this.#stamp());
    try {
      return await capture.run();
    } finally {
      await capture.closeOut();
    }
  }

  discard(workDir: string): void {
    rmSync(workDir, { recursive: true, force: true });
  }

  /**
   * A working folder of another build, mode, or transcript format, or without a readable resume file, is moved aside,
   * never mixed in.
   */
  #prepare(run: CaptureRun): void {
    const resumeFile = join(run.workDir, 'resume.json');
    if (existsSync(run.workDir)) {
      let resume: Partial<ResumeFile> | undefined;
      try {
        resume = JSON.parse(readFileSync(resumeFile, 'utf8')) as Partial<ResumeFile>;
      } catch {
        resume = undefined;
      }
      if (
        resume?.build === run.build &&
        resume.mode === run.mode &&
        resume.transcriptFormat === TRANSCRIPT_FORMAT
      ) {
        return;
      }
      setAside(run.workDir, this.#stamp());
    }
    mkdirSync(run.workDir, { recursive: true });
    const resume: ResumeFile = {
      build: run.build,
      mode: run.mode,
      serverVersion: this.#serverVersion,
      transcriptFormat: TRANSCRIPT_FORMAT,
    };
    writeFileSync(resumeFile, `${JSON.stringify(resume)}\n`);
  }

  #stamp(): string {
    return this.#now().toISOString().replace(/[:.]/g, '-');
  }
}

/** One run: the lease, the working folder, and the phases. */
class Capture {
  #systemInfo = '';

  constructor(
    private readonly spec: CaptureRun,
    private readonly lease: SessionLease,
    private readonly onProgress: (progress: CaptureProgress) => void,
    private readonly signal: AbortSignal,
    private readonly stamp: string,
  ) {}

  async run(): Promise<CaptureResult> {
    await this.#send(['project new blank force']);
    this.lease.bindFresh();
    const [info] = await this.#send(['system info']);
    this.#systemInfo = linesOf(info).join('\n');
    writeFileSync(this.#path('system-info.txt'), `${this.#systemInfo}\n`);
    const build = buildOfSystemInfo(this.#systemInfo);
    if (build !== this.spec.build) {
      throw new Error(`World Machine is build ${build}, but the capture is for build ${this.spec.build}`);
    }
    const discovery = await this.#discover();
    const enumCapture = await this.#enumOptions(discovery);
    const words = [...new Set([...this.spec.known.addWords, ...discovery.types.map((type) => type.addName)])];
    const portTypes = await this.#portTypes(words);
    return { ...enumCapture, portTypes, discovery };
  }

  /** Every run ends on a fresh blank project; after a crash World Machine is gone and this does nothing. */
  async closeOut(): Promise<void> {
    try {
      await this.lease.execute(['project close force']);
      await this.lease.execute(['project new blank force']);
      this.lease.bindFresh();
    } catch {
      // The run's own outcome is the one to report.
    }
  }

  /** One batch, after checking for a cancel; a reply per command. */
  async #send(commands: readonly string[], timeoutMs?: number): Promise<readonly ConsoleReply[]> {
    this.signal.throwIfAborted();
    const replies = await this.lease.execute(commands, timeoutMs);
    if (replies.length < commands.length) {
      throw new Error(`World Machine answered ${replies.length} of ${commands.length} commands`);
    }
    return replies;
  }

  #path(file: string): string {
    return join(this.spec.workDir, file);
  }

  #append(file: string, sections: readonly Section[]): void {
    if (sections.length > 0) appendFileSync(this.#path(file), render(sections));
  }

  #read(file: string): string {
    return existsSync(this.#path(file)) ? readFileSync(this.#path(file), 'utf8') : '';
  }

  #report(phase: CapturePhase, done: number, total: number): void {
    this.onProgress({ phase, done, total });
  }

  /** Spec D2a. Resumed as a whole: a finished discovery is kept in `discovery.json`, an unfinished one starts over. */
  async #discover(): Promise<DeviceDiscovery> {
    const saved = this.#path('discovery.json');
    if (existsSync(saved)) {
      const discovery = this.#fromWorkFolder('discovery.json', () => {
        const read = JSON.parse(readFileSync(saved, 'utf8')) as Partial<DeviceDiscovery>;
        if (!Array.isArray(read.types) || !Array.isArray(read.notReached))
          throw new Error('no types or notReached list');
        return read as DeviceDiscovery;
      });
      this.#report('discover', 1, 1);
      return discovery;
    }
    writeFileSync(this.#path('discover.txt'), '');
    const seeds = new Set([...this.spec.known.addWords, ...this.spec.known.typeNames]).size;
    let adds = 0;
    this.#report('discover', 0, seeds);
    const discovery = await discoverDeviceTypes(async (commands) => {
      const replies = await this.#send(commands, Math.max(60_000, commands.length * 2_000));
      this.#append(
        'discover.txt',
        commands.map((command, i) => ({ command, lines: linesOf(replies[i]) })),
      );
      adds += commands.filter((command) => command.startsWith('device add ')).length;
      this.#report('discover', Math.min(adds, seeds), Math.max(adds, seeds));
      return replies;
    }, this.spec.known);
    const { types, notReached, listedByConsole } = discovery;
    writeFileAtomic(saved, `${JSON.stringify({ types, notReached, listedByConsole }, null, 2)}\n`);
    this.#report('discover', Math.max(adds, seeds), Math.max(adds, seeds));
    return { types, notReached, listedByConsole };
  }

  /**
   * The `enumOptions` scenario, one unit per word: its sections are appended once the unit is done, followed by an
   * `(enum <word>)` section naming the listed type it gave, `duplicate <type>`, `not added`, or `no range error` with
   * the rows that gave none. A resumed run skips the words with such a section. A type already captured is deleted at
   * once, so the catalog never has it twice. A type with an enum row without a range error is left out of the
   * transcript, as the parser needs every label of every row (capture-fixtures.mjs l.3457-3460 records and goes on).
   */
  async #enumOptions(
    discovery: DeviceDiscovery,
  ): Promise<Pick<CaptureResult, 'enumOptions' | 'refusedWords' | 'enumGaps'>> {
    const file = 'enum.txt';
    const finished = new Map<string, string>();
    const captured = new Set<string>();
    const enumGaps: string[] = [];
    for (const { command, lines } of this.#fromWorkFolder(file, () => transcriptSections(this.#read(file)))) {
      const unit = ENUM_UNIT.exec(command);
      if (unit === null) continue;
      const outcome = lines[0] ?? '';
      finished.set(unit[1] as string, outcome);
      if (outcome.startsWith('type ')) captured.add(outcome.slice('type '.length));
      if (outcome === NO_RANGE) enumGaps.push(...lines.slice(1));
    }
    const words = [...new Set([...ENUM_TYPES, ...discovery.types.map((type) => type.addName)])];
    let done = words.filter((word) => finished.has(word)).length;
    this.#report('enum', done, words.length);

    // This run's own device list first, so the parser never compares new ids with an earlier run's.
    const [listed] = await this.#send(['device list']);
    this.#append(file, [{ command: 'device list', lines: linesOf(listed) }]);
    const known = new Set(rowsOf(linesOf(listed)).map((row) => row.id));

    for (const word of words) {
      if (finished.has(word)) continue;
      const sections: Section[] = [];
      const record = (replies: readonly ConsoleReply[]) =>
        sections.push(...replies.map((reply) => ({ command: reply.command, lines: linesOf(reply) })));
      let added = await this.#send([`device add ${word}`, 'device list']);
      record(added);
      const byName = ADD_BY_NAME[word];
      if (byName !== undefined && linesOf(added[0]).some((line) => AMBIGUOUS_ADD.test(line))) {
        added = await this.#send([`device add ${byName}`, 'device list']);
        record(added);
      }
      const rows = rowsOf(linesOf(added[1]));
      const fresh = rows.filter((row) => !known.has(row.id));
      for (const row of rows) known.add(row.id);
      const device = fresh[0];
      let outcome: string[];
      if (device === undefined) {
        // An add that gave no device is left out of the transcript (parseEnumCapture fails on it) and reported.
        outcome = [NOT_ADDED, ...linesOf(added[0])];
        sections.length = 0;
      } else if (captured.has(device.type)) {
        await this.#send([`device delete #${device.id}`]);
        outcome = [`duplicate ${device.type}`];
        sections.length = 0;
      } else {
        const gaps = await this.#enumsOf(device, record);
        record(await this.#send([`device delete #${device.id}`]));
        if (gaps.length > 0) {
          outcome = [NO_RANGE, ...gaps.map((name) => `${device.type}.${name}`)];
          enumGaps.push(...outcome.slice(1));
          sections.length = 0;
        } else {
          captured.add(device.type);
          outcome = [`type ${device.type}`];
        }
      }
      this.#append(file, [...sections, { command: `(enum ${word})`, lines: outcome }]);
      finished.set(word, outcome[0] as string);
      this.#report('enum', ++done, words.length);
    }

    const { catalog } = this.#fromWorkFolder(file, () =>
      parseEnumCapture(this.#read(file), this.#systemInfo),
    );
    const refusedWords = words.filter((word) => finished.get(word) === NOT_ADDED);
    return { enumOptions: catalog, refusedWords, enumGaps };
  }

  /**
   * The `param list` of a new device, then per enum row its range and every label (capture-fixtures.mjs). Returns the
   * enum rows that gave no range error.
   */
  async #enumsOf(device: Row, record: (replies: readonly ConsoleReply[]) => void): Promise<string[]> {
    const ref = `#${device.id}`;
    const listed = await this.#send([`param list ${ref}`]);
    record(listed);
    const enums = linesOf(listed[0]).flatMap((line) => {
      const row = PARAM_ROW.exec(line);
      return row !== null && row[2] === 'enum' ? [row[1] as string] : [];
    });
    const gaps: string[] = [];
    for (const name of enums) {
      const probe = await this.#send([`param get ${ref}.${name}`, `param set "${ref}.${name}" 9999`]);
      record(probe);
      const range = linesOf(probe[1])
        .map((line) => RANGE.exec(line.trimEnd()))
        .find((match) => match !== null);
      if (range === undefined || range === null) {
        gaps.push(name);
        continue;
      }
      const last = Number(range[1]);
      if (last < 0) continue;
      record(
        await this.#send(
          Array.from({ length: last + 1 }, (_, index) => [
            `param set "${ref}.${name}" ${index}`,
            `param get ${ref}.${name}`,
          ]).flat(),
        ),
      );
    }
    return gaps;
  }

  /**
   * `portTypesBody` of capture-fixtures.mjs: short probes the first three outputs checked and the next three lean and
   * checks them against the base; full probes every output, then the twin pass (`addTwins`). One transcript,
   * resumed after its `(setup complete)` section by adding the same words again (unrecorded) and checking World
   * Machine gives the same device list.
   */
  async #portTypes(words: readonly string[]): Promise<CaptureResult['portTypes']> {
    const full = this.spec.mode === 'full';
    const phase: CapturePhase = full ? 'probe' : 'sample';
    const file = full ? 'probe.txt' : 'sample.txt';
    this.#report(phase, 0, 0);
    let setup = this.#fromWorkFolder(file, () => readSetup(this.#read(file), full));
    if (setup === undefined) {
      writeFileSync(this.#path(file), '');
      setup = await this.#recordSetup(file, words, full);
    } else {
      await this.#replaySetup(file, setup);
    }

    const units = probeUnits(setup, full);
    const { done, suspects } = this.#fromWorkFolder(file, () => readProbes(this.#read(file)));
    const total = units.reduce((sum, unit) => sum + unit.targets.length, 0);
    let answered = units.reduce(
      (sum, unit) => sum + unit.targets.filter((target) => done.has(pairKey(unit.source, target))).length,
      0,
    );
    this.#report(phase, answered, total);
    for (const unit of units) {
      const from = `#${unit.source.id}.${unit.source.port}`;
      const remaining = unit.targets.filter((target) => !done.has(pairKey(unit.source, target)));
      for (const chunk of chunks(remaining, (target) => suspects.has(pairKey(unit.source, target)))) {
        const sent = chunk.map((target) => probeCommands(unit.source, target, unit.lean));
        const batch = sent.flat();
        let replies: readonly ConsoleReply[];
        try {
          replies = await this.#send(batch, Math.max(60_000, batch.length * 1_000));
        } catch (error) {
          if (hasCode(error, 'CRASHED')) this.#recordLoss(file, from, chunk, sent);
          else if (hasCode(error, 'TIMEOUT')) this.#recordSuspects(file, from, chunk);
          throw error;
        }
        let at = 0;
        const lines = chunk.map((target, index) => {
          const mine = replies.slice(at, at + (sent[index] as string[]).length).map((reply) => ({
            lines: linesOf(reply),
          }));
          at += (sent[index] as string[]).length;
          return `#${target.id}.${target.port} ${probeVerdict(unit.source, target, mine, unit.lean)}`;
        });
        this.#append(file, [{ command: `(probe ${from})`, lines }]);
        answered += chunk.length;
        this.#report(phase, answered, total);
      }
    }

    const transcript = this.#read(file);
    const base = this.spec.base;
    if (!full) {
      if (base === undefined) throw new Error('a short capture needs a strict base catalog');
      return this.#fromWorkFolder(
        file,
        () => checkSample(base, transcript, this.#systemInfo) satisfies SampleCheck,
      );
    }
    const catalog: PortTypeCatalog = this.#fromWorkFolder(file, () =>
      nameClasses(parsePortTypeCatalog([transcript], this.#systemInfo), base),
    );
    return { agreed: true, catalog };
  }

  /**
   * Port-types design section 3, crashes and resumes. The lease gives no answers of a batch World Machine did not
   * finish, so only a one-pair batch tells which pair it was on: that pair is `crashed`, a hole, and never sent again.
   * A longer batch leaves its pairs suspect; the next run sends them one per batch. Only CRASHED comes here: a
   * timeout says nothing about the pair (capture-fixtures.mjs l.3532-3533 stops without a verdict).
   */
  #recordLoss(file: string, from: string, chunk: readonly ProbeTarget[], sent: readonly string[][]): void {
    const crashed = chunk.length === 1 ? crashedTarget(sent, 0) : undefined;
    const target = crashed === undefined ? undefined : chunk[crashed];
    if (target !== undefined) {
      this.#append(file, [
        { command: `(probe ${from})`, lines: [`#${target.id}.${target.port} ${CRASHED}`] },
      ]);
    } else {
      this.#recordSuspects(file, from, chunk);
    }
  }

  /** The pairs of a batch World Machine did not answer: sent again, one per batch, by the next run. */
  #recordSuspects(file: string, from: string, chunk: readonly ProbeTarget[]): void {
    this.#append(file, [
      { command: `(suspect ${from})`, lines: chunk.map((other) => `#${other.id}.${other.port}`) },
    ]);
  }

  /**
   * Reads the working folder's own files. When they cannot be parsed, every later run would fail the same way, so the
   * folder is moved aside and the next capture starts over; the failure names both paths.
   */
  #fromWorkFolder<T>(what: string, read: () => T): T {
    try {
      return read();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const folder = this.spec.workDir;
      let moved: string;
      try {
        moved = `it was moved to ${setAside(folder, this.stamp)}, and the next capture starts over`;
      } catch {
        moved = 'delete it to start over';
      }
      throw new Error(`cannot read ${what} in the capture's working folder ${folder} (${reason}); ${moved}`);
    }
  }

  /** A blank project, every word added and listed, the ports of every added device, and for full the twins. */
  async #recordSetup(file: string, words: readonly string[], full: boolean): Promise<Setup> {
    const record = (replies: readonly ConsoleReply[], extra: Section[] = []) =>
      this.#append(file, [
        ...replies.map((reply) => ({ command: reply.command, lines: linesOf(reply) })),
        ...extra,
      ]);
    const opened = await this.#send(['project new blank force', 'device list']);
    record(opened);
    let rows = rowsOf(linesOf(opened[1]));
    const known = new Set(rows.map((row) => row.id));
    const added: PortDevice[] = [];
    for (const word of words) {
      const reply = await this.#send([`device add ${word}`, 'device list']);
      rows = rowsOf(linesOf(reply[1]));
      const fresh = rows.find((row) => !known.has(row.id));
      for (const row of rows) known.add(row.id);
      if (fresh === undefined) {
        record(reply, [{ command: `(type ${word} not added)`, lines: linesOf(reply[0]) }]);
      } else {
        record(reply);
        added.push({ ...fresh, word, inputs: [], outputs: [] });
      }
    }
    // Plan decision D11: the ports after every add, so every input is still free before probing.
    if (added.length > 0) {
      const lists = await this.#send(
        added.map((device) => `wire list #${device.id}`),
        Math.max(60_000, added.length * 2_000),
      );
      record(lists);
      lists.forEach((reply, index) => {
        setPorts(added[index] as PortDevice, linesOf(reply));
      });
    }
    const probed = firstOfEachType(added);
    const twinWords = full ? twinned(probed).map((device) => device.word) : [];
    const twins: Twin[] = [];
    // Design section 3, same-device holes: the twin pass's adds are not recorded, only each twin's ports.
    for (const device of full ? twinned(probed) : []) {
      const reply = await this.#send([`device add ${device.word}`, 'device list']);
      const fresh = rowsOf(linesOf(reply[1])).find((row) => !known.has(row.id));
      if (fresh === undefined) {
        this.#append(file, [{ command: `(twin #${device.id} stopped)`, lines: linesOf(reply[0]) }]);
        continue;
      }
      known.add(fresh.id);
      twins.push({ of: device, id: fresh.id, inputs: [], outputs: [] });
    }
    if (twins.length > 0) {
      const lists = await this.#send(
        twins.map((twin) => `wire list #${twin.id}`),
        Math.max(60_000, twins.length * 2_000),
      );
      lists.forEach((reply, index) => {
        const twin = twins[index] as Twin;
        this.#append(file, [{ command: `(twin #${twin.of.id} #${twin.id})`, lines: linesOf(reply) }]);
        setPorts(twin, linesOf(reply));
      });
    }
    this.#append(file, [
      { command: SETUP_COMPLETE, lines: [`${words.length} words, ${twins.length} twins`] },
    ]);
    return { words, rows, probed, twinWords, twins };
  }

  /** The recorded setup again, unrecorded; a different device list sets the transcript aside and ends the run. */
  async #replaySetup(file: string, setup: Setup): Promise<void> {
    await this.#send(['project new blank force']);
    const listed = (replies: readonly ConsoleReply[]) => rowsOf(linesOf(replies.at(-1)));
    const again = setup.words.length === 0 ? [] : listed(await this.#addAll(setup.words));
    const show = (rows: readonly Row[]) => rows.map((row) => `#${row.id} ${row.type}`).join(', ');
    let difference: string | undefined;
    if (show(again) !== show(setup.rows)) difference = `expected ${show(setup.rows)}, got ${show(again)}`;
    if (difference === undefined && setup.twinWords.length > 0) {
      const withTwins = listed(await this.#addAll(setup.twinWords));
      const missing = setup.twins.find(
        (twin) => !withTwins.some((row) => row.id === twin.id && row.type === twin.of.type),
      );
      if (missing !== undefined) difference = `no twin #${missing.id} of type '${missing.of.type}'`;
    }
    if (difference !== undefined) {
      const aside = this.#path(`${file.replace(/\.txt$/, '')}.stale-${this.stamp}.txt`);
      renameSync(this.#path(file), aside);
      throw new Error(
        `cannot resume ${this.#path(file)}: World Machine gave other devices than the recorded run (${difference}); it was moved to ${aside}, and the next capture starts this phase again`,
      );
    }
    this.#append(file, [
      {
        command: '(resumed)',
        lines: [`re-added ${setup.words.length + setup.twinWords.length} words, list unchanged`],
      },
    ]);
  }

  #addAll(words: readonly string[]): Promise<readonly ConsoleReply[]> {
    return this.#send(
      [...words.map((word) => `device add ${word}`), 'device list'],
      Math.max(60_000, words.length * 2_000),
    );
  }
}

const twinned = (probed: readonly PortDevice[]): PortDevice[] =>
  probed.filter((device) => device.inputs.length > 0 && device.outputs.length > 0);

function setPorts(
  device: { id: number; inputs: number[]; outputs: number[] },
  lines: readonly string[],
): void {
  const ports = readProbeWireList({ lines });
  if (ports === undefined)
    throw new Error(`wire list #${device.id}: unreadable answer: ${lines.join(' | ')}`);
  device.inputs = ports.inputs.map((input) => input.port);
  device.outputs = ports.outputs.map((output) => output.port);
}

/** The pairs of the phase: per output, every input of every other probed device; for full, then the twins. */
function probeUnits(setup: Setup, full: boolean): Unit[] {
  const sources = setup.probed.flatMap((device) =>
    device.outputs.map((port): ProbeSource => ({ id: device.id, name: device.name, port })),
  );
  const targetsOf = (source: ProbeSource): ProbeTarget[] =>
    setup.probed
      .filter((device) => device.id !== source.id)
      .flatMap((device) => device.inputs.map((port) => ({ id: device.id, port, inputs: device.inputs })));
  if (!full) {
    return sources
      .slice(0, 6)
      .map((source, index) => ({ source, lean: index >= 3, targets: targetsOf(source) }));
  }
  const twinUnits = setup.twins.flatMap((twin) =>
    twin.of.outputs.map(
      (port): Unit => ({
        source: { id: twin.of.id, name: twin.of.name, port },
        lean: false,
        targets: twin.inputs.map((input) => ({ id: twin.id, port: input, inputs: twin.inputs })),
      }),
    ),
  );
  return [...sources.map((source) => ({ source, lean: false, targets: targetsOf(source) })), ...twinUnits];
}

/** Consecutive targets in one batch; a suspect one alone. */
function chunks<T>(items: readonly T[], alone: (item: T) => boolean): T[][] {
  const result: T[][] = [];
  let current: T[] = [];
  for (const item of items) {
    if (alone(item)) {
      if (current.length > 0) result.push(current);
      result.push([item]);
      current = [];
    } else current.push(item);
  }
  if (current.length > 0) result.push(current);
  return result;
}

/** The pairs a transcript has a verdict for (`crashed` included), and the pairs a lost batch left suspect. */
function readProbes(transcript: string): { done: Set<string>; suspects: Set<string> } {
  const done = new Set<string>();
  const suspects = new Set<string>();
  for (const { command, lines } of transcriptSections(transcript)) {
    const probe = PROBE.exec(command) ?? SUSPECT.exec(command);
    if (probe === null) continue;
    const into = command.startsWith('(probe ') ? done : suspects;
    for (const line of lines) {
      const target = VERDICT.exec(`${line} `);
      if (target !== null) into.add(`${probe[1]}.${probe[2]}>${target[1]}.${target[2]}`);
    }
  }
  return { done, suspects };
}

/** The setup of a port-type transcript, or undefined when it has no `(setup complete)` section. */
function readSetup(transcript: string, full: boolean): Setup | undefined {
  const sections = transcriptSections(transcript);
  const end = sections.findIndex((section) => section.command === SETUP_COMPLETE);
  if (end === -1) return undefined;
  const words: string[] = [];
  const added: PortDevice[] = [];
  const twins: Twin[] = [];
  let rows: Row[] = [];
  let adding: { word: string; before: Set<number> } | undefined;
  for (const { command, lines } of sections.slice(0, end)) {
    if (command.startsWith('device add ')) {
      const word = command.slice('device add '.length);
      words.push(word);
      adding = { word, before: new Set(rows.map((row) => row.id)) };
    } else if (command === 'device list') {
      rows = rowsOf(lines);
      if (adding !== undefined) {
        const fresh = rows.find((row) => !adding?.before.has(row.id));
        if (fresh !== undefined) added.push({ ...fresh, word: adding.word, inputs: [], outputs: [] });
        adding = undefined;
      }
    } else if (command.startsWith('wire list #')) {
      const device = added.find((candidate) => `wire list #${candidate.id}` === command);
      if (device !== undefined) setPorts(device, lines);
    } else {
      const twin = TWIN.exec(command);
      const of = twin === null ? undefined : added.find((device) => device.id === Number(twin[1]));
      if (twin !== null && of !== undefined) {
        const entry: Twin = { of, id: Number(twin[2]), inputs: [], outputs: [] };
        setPorts(entry, lines);
        twins.push(entry);
      }
    }
  }
  const probed = firstOfEachType(added);
  return { words, rows, probed, twinWords: full ? twinned(probed).map((device) => device.word) : [], twins };
}
