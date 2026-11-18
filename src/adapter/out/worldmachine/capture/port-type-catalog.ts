// Parses the `port-types` capture of scripts/capture-fixtures.mjs into the port-type catalog of the port-types design
// (docs/superpowers/specs/2026-10-13-worldmachine-mcp-port-types-design.md, section 4). One module for
// scripts/build-port-type-catalog.mjs and its tests, so the shipped catalog and its parity test read a transcript alike.
import type { PortTypeCatalog, PortTypeCatalogEntry } from '../../../../domain/catalog.js';
import { buildOfSystemInfo, transcriptSections } from './transcript.js';
import { DEVICE_ROW, readWireList, type WireListPort } from './wire-list.js';

export type PortTypeCatalogPortEntry = PortTypeCatalogEntry;
export type PortTypeCatalogData = PortTypeCatalog;

/** An added device of a transcript: its listed type, its add word, and its ports once its `wire list` was read. */
type Device = {
  id: string;
  type: string;
  word: string;
  inputs: WireListPort[] | undefined;
  outputs: WireListPort[] | undefined;
};
/** A device whose ports are known. */
type Listed = Device & { inputs: WireListPort[]; outputs: WireListPort[] };
type Port = WireListPort & { device: Device; key: string };
type PortClass = { id: string; members: Port[]; cells: Map<string, boolean> };

const ADD = /^device add (.+)$/;
// src/adapter/out/worldmachine/parsers/device-list.ts: the header before the rows (raw/device-list-sample.txt).
const DEVICE_LIST_HEADER = /^Devices \(\d+ total\):$/;
// Codex round 3 ruling: an empty project's whole answer (raw/p2a-edge-cases.txt l.77, raw/v7-project-ops.txt l.30,
// raw/p2c-undo-names.txt l.28).
const NO_DEVICES = 'No devices in the current project.';
// Codex round 2 ruling 1: the log lines a `(printed between batches)` section may hold. transcriptSections drops
// LOG_LINE lines (src/domain/errors.ts l.35, copied in enum-catalog.mjs); a build event does not match that prefix
// (src/adapter/out/worldmachine/build-events.ts l.3 and l.16, fact 47). scripts/capture-fixtures.mjs itself filters
// only licence lines (l.30, l.118), so every other line reaches the transcript.
const BUILD_EVENT = '[Build Event] ';
const WIRE_LIST = /^wire list #(\d+)$/;
// Port-types plan decision D13: a type whose add showed no new device is recorded and skipped.
const NOT_ADDED = /^\(type (.+) not added\)$/;
// Plan decision D11: one section per output port, one verdict line per input of every other device.
const PROBE = /^\(probe #(\d+)\.(\d+)\)$/;
// Design section 3, crashes and resumes: `crashed` is the pair in flight when World Machine exited, a hole.
const VERDICT = /^#(\d+)\.(\d+) (connected|refused(?: stray(?: #\d+\.\d+)+)?|crashed|error: .*)$/;
// Plan decision D13: a type or the whole scenario that threw is recorded as its own section.
const STOPPED = /^\((type .* stopped|scenario stopped)\)$/;
// Design section 3, crashes and resumes: a probe that threw leaves its output unprobed in that transcript.
const PROBE_STOPPED = /^\(probe .* stopped\)$/;
// Design section 3, same-device holes: a twin of a probed device with its `wire list` answer, or a twin not added.
const TWIN = /^\(twin #(\d+) #(\d+)\)$/;
const TWIN_STOPPED = /^\(twin #(\d+) stopped\)$/;

/** A device's port numbers and names, in order, for comparing two devices of one type. */
const shape = (device: {
  inputs?: readonly WireListPort[] | undefined;
  outputs?: readonly WireListPort[] | undefined;
}) =>
  JSON.stringify(
    [device.inputs, device.outputs].map((ports) => ports?.map(({ port, name }) => [port, name])),
  );

/** A port for messages: `'<type>.<name>'`. */
const named = (port: Port) => `'${port.device.type}.${port.name}'`;
/** Design section 4: a class without a names entry is named by its first port in catalog order. */
const like = (portClass: PortClass) =>
  `like ${portClass.members[0]?.device.type} ${portClass.members[0]?.name}`;

/**
 * One `(probe #<id>.<port>)` section (plan decision D11): a verdict per input of every other device, into `verdicts`
 * as `connected`, `refused`, or `crashed`. Design section 3, same-device holes: a verdict on an input of the source's
 * twin (`twins`, twin id to probed id) is the cell of the source's own pair; on a twin of another device it throws.
 */
function readProbe(
  command: string,
  lines: readonly string[],
  sourceId: string,
  port: number,
  devices: Map<string, Device>,
  twins: Map<string, string>,
  verdicts: Map<string, string>,
): void {
  if (!devices.get(sourceId)?.outputs?.some((output) => output.port === port)) {
    throw new Error(`${command}: not an output of a listed device`);
  }
  for (const line of lines) {
    const verdict = VERDICT.exec(line);
    if (verdict === null) throw new Error(`${command}: unreadable line '${line}'`);
    const [, targetId, targetPort, answer] = verdict as unknown as [string, string, string, string];
    const pair = `#${sourceId}.${port} -> #${targetId}.${targetPort}`;
    if (targetId === sourceId) throw new Error(`${pair}: a pair on one device`);
    const probed = twins.get(targetId);
    if (probed !== undefined && probed !== sourceId)
      throw new Error(`${pair}: an input of the twin of #${probed}`);
    const target = probed ?? targetId;
    if (!devices.get(target)?.inputs?.some((input) => input.port === Number(targetPort))) {
      throw new Error(`${pair}: not an input of a listed device`);
    }
    // Design section 4: no catalog rests on an unexplained answer.
    if (answer.startsWith('error: ')) throw new Error(`${pair}: ${answer.slice('error: '.length)}`);
    // Codex round 1 ruling B2: a refusal that left a wire contradicts design section 2, so it fails as well.
    if (answer.startsWith('refused stray')) throw new Error(`${pair}: ${answer}`);
    const key = `${sourceId}.${port}>${target}.${targetPort}`;
    if (verdicts.has(key)) throw new Error(`${pair}: probed twice`);
    verdicts.set(key, answer);
  }
}

/**
 * Design section 4, plan decision D14: ports whose cells agree wherever both are known form one class. Greedy in
 * catalog order, then every port is matched against the final classes, so a port that matches two classes fails and
 * a hole never decides a class. `cellsOf(port)` maps the other side's port keys to true (connected) or false.
 */
function classify(
  ports: readonly Port[],
  cellsOf: (port: Port) => Map<string, boolean>,
  prefix: string,
  kind: string,
): PortClass[] {
  const classes: PortClass[] = [];
  const matching = (cells: Map<string, boolean>) =>
    classes.filter((portClass) =>
      [...cells].every(([key, value]) => !portClass.cells.has(key) || portClass.cells.get(key) === value),
    );
  const ambiguous = (port: Port, found: readonly PortClass[]) =>
    new Error(`${kind} ${named(port)} matches ${found.length} classes: ${found.map(like).join(', ')}`);
  for (const port of ports) {
    const cells = cellsOf(port);
    // Design section 4: a hole never decides a class, so a port with no known cell has nothing to be classed by.
    if (cells.size === 0) throw new Error(`${kind} ${named(port)}: no probed cell`);
    const found = matching(cells);
    if (found.length > 1) throw ambiguous(port, found);
    const portClass: PortClass = found[0] ?? {
      id: `${prefix}${classes.length + 1}`,
      members: [],
      cells: new Map(),
    };
    if (found.length === 0) classes.push(portClass);
    portClass.members.push(port);
    for (const [key, value] of cells) portClass.cells.set(key, value);
  }
  for (const port of ports) {
    const found = matching(cellsOf(port));
    if (found.length > 1) throw ambiguous(port, found);
  }
  return classes;
}

/** Design section 4, plan decision D14: the answer of the probed pairs of two classes; none, or both, throws. */
function accepts(outputClass: PortClass, inputClass: PortClass, cells: Map<string, boolean>): boolean {
  const known = new Set(
    outputClass.members.flatMap((output) =>
      inputClass.members.flatMap((input) => {
        const cell = cells.get(`${output.key}>${input.key}`);
        return cell === undefined ? [] : [cell];
      }),
    ),
  );
  if (known.size !== 1) {
    throw new Error(
      `${known.size === 0 ? 'no probed pair' : 'both answers'} between the output class ${like(outputClass)} and the input class ${like(inputClass)}`,
    );
  }
  return known.has(true);
}

/**
 * Design section 4, plan decision D14: `names` maps a representative port, `<type>.<output port name>`, to its class's
 * name; a class without an entry is named by its first port in catalog order. An entry that names no output port,
 * names ports of two classes, or names a class another entry names, throws.
 */
function classNames(
  outputClasses: readonly PortClass[],
  outputs: readonly Port[],
  names: Readonly<Record<string, string>>,
): Record<string, string> {
  const classOf = new Map(
    outputClasses.flatMap((outputClass) => outputClass.members.map((output) => [output.key, outputClass.id])),
  );
  const entries = new Map<string | undefined, { entry: string; name: string }>();
  for (const [entry, name] of Object.entries(names)) {
    const ids = new Set(
      outputs
        .filter((output) => `${output.device.type}.${output.name}` === entry)
        .map((output) => classOf.get(output.key)),
    );
    if (ids.size === 0) throw new Error(`names: '${entry}' names no output port`);
    if (ids.size > 1) throw new Error(`names: '${entry}' names ports of ${ids.size} classes`);
    const [id] = ids;
    const earlier = entries.get(id);
    if (earlier !== undefined) throw new Error(`names: '${earlier.entry}' and '${entry}' name one class`);
    entries.set(id, { entry, name });
  }
  return Object.fromEntries(
    outputClasses.map((outputClass) => [
      outputClass.id,
      entries.get(outputClass.id)?.name ?? like(outputClass),
    ]),
  );
}

/**
 * One `port-types` transcript: its added devices by id, in transcript order, `{ id, type, word, inputs, outputs }`
 * with ports from their wire list, and its verdicts by `<output id>.<port>><input id>.<port>`. A stopped type or
 * scenario, an error answer, a refusal recorded with a stray wire, or a pair probed twice throws. A twin's verdict is
 * keyed as its probed device's own pair (design section 3, same-device holes); a twin with other ports throws.
 */
export function readTranscript(transcript: string): {
  devices: Map<string, Listed>;
  verdicts: Map<string, string>;
} {
  /** Ids to listed types of the last `device list`. */
  let listed = new Map<string, string>();
  /** The `device add` whose device has to show up in the next `device list`, or be recorded as not added. */
  let adding: { word: string; before: Map<string, string> } | undefined;
  /** True from `project new blank force` until the device list after it. */
  let blank = false;
  /** Added devices by id, in transcript order: `{ id, type, word, inputs, outputs }`, ports from their wire list. */
  const devices = new Map<string, Device>();
  /** Design section 3, same-device holes: twin ids to the ids of their probed devices. */
  const twins = new Map<string, string>();
  const verdicts = new Map<string, string>();
  for (const { command, lines } of transcriptSections(transcript)) {
    if (STOPPED.test(command)) throw new Error(`the capture did not complete: ${command}`);
    if (PROBE_STOPPED.test(command)) continue;
    const add = ADD.exec(command);
    if (add) {
      if (adding !== undefined)
        throw new Error(`device add ${adding.word}: no new device and no not-added record`);
      adding = { word: add[1] as string, before: listed };
      continue;
    }
    // Codex round 2 ruling 1: the blank project's first device list must be empty.
    if (command === 'project new blank force') {
      blank = true;
      continue;
    }
    // Codex round 2 ruling 1: lines World Machine printed on its own may only be log lines; transcriptSections has
    // dropped the LOG_LINE ones, so only a `[Build Event] ` line may remain.
    if (command === '(printed between batches)') {
      const unexpected = lines.find((line) => !line.startsWith(BUILD_EVENT));
      if (unexpected !== undefined) throw new Error(`${command}: unexpected line '${unexpected}'`);
      continue;
    }
    if (command === 'device list') {
      // Codex round 3 ruling: an empty project answers with one line instead of a header and rows.
      const empty = lines.length === 1 && lines[0]?.trimEnd() === NO_DEVICES;
      // Codex round 2 ruling 1: every row must read, so no device is missed.
      const [header, ...rows] = empty ? [] : lines;
      if (!empty && !DEVICE_LIST_HEADER.test(header ?? '')) {
        throw new Error(`device list: unreadable header '${header}'`);
      }
      const unreadable = rows.find((line) => !DEVICE_ROW.test(line));
      if (unreadable !== undefined) throw new Error(`device list: unreadable row '${unreadable}'`);
      listed = new Map(
        rows.map((line): [string, string] => {
          const match = DEVICE_ROW.exec(line) as RegExpExecArray;
          return [match[1] as string, (match[3] ?? match[2]) as string];
        }),
      );
      if (blank) {
        blank = false;
        if (!empty) throw new Error(`device list after project new blank force: not '${NO_DEVICES}'`);
      }
      if (adding === undefined) continue;
      const before = adding.before;
      const fresh = [...listed.keys()].filter((id) => !before.has(id));
      if (fresh.length > 1)
        throw new Error(`device add ${adding.word}: ${fresh.length} new devices in the device list`);
      if (fresh.length === 0) continue;
      // Codex round 1 ruling B1: the add word is kept; several words may give one listed type (raw/v3-rename-types.txt).
      const freshId = fresh[0] as string;
      devices.set(freshId, {
        id: freshId,
        type: listed.get(freshId) as string,
        word: adding.word,
        inputs: undefined,
        outputs: undefined,
      });
      adding = undefined;
      continue;
    }
    const notAdded = NOT_ADDED.exec(command);
    if (notAdded) {
      if (adding?.word !== notAdded[1]) throw new Error(`${command}: not the type whose add is pending`);
      adding = undefined;
      continue;
    }
    const list = WIRE_LIST.exec(command);
    if (list) {
      const device = devices.get(list[1] as string);
      if (device === undefined) throw new Error(`${command}: not a device the capture added`);
      if (device.inputs !== undefined) throw new Error(`${command}: listed twice`);
      Object.assign(device, readWireList(command, lines));
      continue;
    }
    const twin = TWIN.exec(command);
    if (twin) {
      const [probedId, twinId] = [twin[1] as string, twin[2] as string];
      const probed = devices.get(probedId);
      if (
        probed === undefined ||
        [...devices.values()].find((other) => other.type === probed.type) !== probed
      ) {
        throw new Error(`${command}: not a probed device`);
      }
      if (devices.has(twinId) || twins.has(twinId)) throw new Error(`${command}: not a new device`);
      if (shape(readWireList(command, lines)) !== shape(probed)) {
        throw new Error(`twin #${twinId} of #${probedId}: other ports than its probed device`);
      }
      twins.set(twinId, probedId);
      continue;
    }
    // Design section 3, same-device holes: a twin that was not added leaves its device's own pairs holes.
    if (TWIN_STOPPED.test(command)) continue;
    const probe = PROBE.exec(command);
    if (probe) readProbe(command, lines, probe[1] as string, Number(probe[2]), devices, twins, verdicts);
  }
  if (adding !== undefined)
    throw new Error(`device add ${adding.word}: no new device and no not-added record`);
  for (const device of devices.values()) {
    if (device.inputs === undefined) throw new Error(`#${device.id} '${device.type}': no wire list`);
  }
  return { devices: devices as Map<string, Listed>, verdicts };
}

/** A device for messages: id, listed type, add word, and ports, as compared across transcripts. */
const described = (device: Listed): string => {
  const ports = (list: readonly WireListPort[]) =>
    list.length === 0 ? 'none' : list.map(({ port, name }) => `${port} ${name}`).join(', ');
  return `#${device.id} '${device.type}' (device add ${device.word}) inputs ${ports(device.inputs)} outputs ${ports(device.outputs)}`;
};

/**
 * The catalog `{ build, kind, outputClasses, inputClasses, types }` of the `port-types` transcripts of one build and the
 * `system info` capture of that build, the classes named by `names` (design section 4, plan decisions D4 and D14). A
 * type is keyed by its new device's listed type (fact 81: the kind in its `device list` row, or else its name), with
 * every `device add` word that gave it (`added`, Codex round 1 ruling B1) and its ports in `wire list` order with their
 * class ids.
 * Design section 3, crashes and resumes: every transcript must list the same devices and ports, a pair probed in two
 * transcripts must have one verdict, and a stopped probe leaves its output to another transcript.
 * A pair on one device without a twin verdict (design section 3, same-device holes) and a crashed pair have no answer,
 * so their cells are unknown and ignored. A stopped step, an error answer, a refusal recorded with a stray wire, a gap,
 * or a port that matches two classes throws, so the catalog never rests on a hole.
 */
export function parsePortTypeCatalog(
  transcripts: readonly string[],
  systemInfo: string,
  names: Readonly<Record<string, string>> = {},
): PortTypeCatalogData {
  const build = buildOfSystemInfo(systemInfo);
  const read = transcripts.map(readTranscript);
  const [{ devices }] = read as [(typeof read)[number], ...typeof read];
  const first = [...devices.values()].map(described);
  for (const [index, other] of read.entries()) {
    const shown = [...other.devices.values()].map(described);
    const at = [...Array(Math.max(first.length, shown.length)).keys()].find((i) => shown[i] !== first[i]);
    if (at !== undefined) {
      throw new Error(
        `transcript ${index + 1}: ${shown[at] ?? 'no device'} where transcript 1 has ${first[at] ?? 'no device'}`,
      );
    }
  }
  /** `<output id>.<port>><input id>.<port>` to its verdict in every transcript that probed it. */
  const verdicts = new Map<string, string>();
  for (const other of read) {
    for (const [key, verdict] of other.verdicts) {
      if ((verdicts.get(key) ?? verdict) !== verdict) {
        throw new Error(`#${key.replace('>', ' -> #')}: probed differently`);
      }
      verdicts.set(key, verdict);
    }
  }
  /** The answered pairs: true (connected) or false (refused). */
  const cells = new Map(
    [...verdicts].flatMap(([key, verdict]) =>
      verdict === 'crashed' ? [] : [[key, verdict === 'connected']],
    ),
  );
  const all = [...devices.values()];
  // B1 addendum ruling: only the first device of each listed type is probed; every other word that gave the type is
  // in `added` when its device shows the same port names, and fails the generation otherwise.
  const catalogued = all.filter(
    (device, index) => all.findIndex((other) => other.type === device.type) === index,
  );
  for (const device of all) {
    const probed = catalogued.find((candidate) => candidate.type === device.type) as Listed;
    if (shape(device) !== shape(probed)) {
      throw new Error(`type '${device.type}': '${device.word}' gives other ports than '${probed.word}'`);
    }
  }
  for (const key of verdicts.keys()) {
    const [from, to] = key.split('>').map((ref) => ref.split('.')[0]);
    if (!catalogued.some((device) => device.id === from) || !catalogued.some((device) => device.id === to)) {
      throw new Error(`#${key.replace('>', ' -> #')}: a device that is not the probed one of its type`);
    }
  }
  const portsOf = (kind: 'inputs' | 'outputs'): Port[] =>
    catalogued.flatMap((device) =>
      device[kind].map((port) => ({ device, ...port, key: `${device.id}.${port.port}` })),
    );
  const outputs = portsOf('outputs');
  const inputs = portsOf('inputs');
  for (const output of outputs) {
    for (const input of inputs) {
      if (output.device !== input.device && !verdicts.has(`${output.key}>${input.key}`)) {
        throw new Error(`#${output.key} -> #${input.key}: not probed`);
      }
    }
  }
  // Design section 4: a pair on one device without a twin verdict and a crashed pair are left out, so they never decide
  // a class.
  const rowOf = (output: Port) =>
    new Map<string, boolean>(
      inputs
        .filter((input) => cells.has(`${output.key}>${input.key}`))
        .map((input): [string, boolean] => [input.key, cells.get(`${output.key}>${input.key}`) as boolean]),
    );
  const columnOf = (input: Port) =>
    new Map<string, boolean>(
      outputs
        .filter((output) => cells.has(`${output.key}>${input.key}`))
        .map((output): [string, boolean] => [output.key, cells.get(`${output.key}>${input.key}`) as boolean]),
    );
  const outputClasses = classify(outputs, rowOf, 'o', 'output');
  const inputClasses = classify(inputs, columnOf, 'i', 'input');
  const classIndex = (classes: readonly PortClass[]) =>
    new Map(
      classes.flatMap((portClass) =>
        portClass.members.map((port): [string, string] => [port.key, portClass.id]),
      ),
    );
  const outputClassOf = classIndex(outputClasses);
  const inputClassOf = classIndex(inputClasses);
  const types: Record<
    string,
    { added: string[]; inputs: PortTypeCatalogPortEntry[]; outputs: PortTypeCatalogPortEntry[] }
  > = {};
  for (const device of catalogued) {
    types[device.type] = {
      // Codex round 1 ruling B1 and its addendum: every accepted add word that gave this type, in transcript order.
      added: all.filter((other) => other.type === device.type).map((other) => other.word),
      inputs: device.inputs.map(({ port, name }) => ({
        port,
        name,
        class: inputClassOf.get(`${device.id}.${port}`) as string,
      })),
      outputs: device.outputs.map(({ port, name }) => ({
        port,
        name,
        class: outputClassOf.get(`${device.id}.${port}`) as string,
      })),
    };
  }
  return {
    build,
    kind: 'strict',
    outputClasses: classNames(outputClasses, outputs, names),
    inputClasses: Object.fromEntries(
      inputClasses.map((inputClass) => [
        inputClass.id,
        outputClasses
          .filter((outputClass) => accepts(outputClass, inputClass, cells))
          .map((outputClass) => outputClass.id),
      ]),
    ),
    types,
  };
}

/**
 * `{ catalog, omittedTypes, movedWords }`: the catalog of another build derived from the full catalog `base` of one build and a
 * `port-types-sample` transcript of the new build with its `system info` (build 4069, 2026-11-17; a full run takes
 * hours). The new catalog keeps the classes and ports of `base`, keeps only the types the sample added, and lists as
 * `added` only the words that gave each type in the sample. Every listed type must show the ports of `base` and every
 * verdict must follow from the classes of `base`; otherwise it throws, so the derived catalog rests only on what the
 * sample measured. `omittedTypes` are the types of `base` the sample did not add; `movedWords` the add words that gave
 * another type than in `base` (`Surface` gives a Material on 4069, port-types-sample.txt l.14491-14492).
 */
export function derivePortTypeCatalog(
  base: PortTypeCatalogData,
  sample: string,
  systemInfo: string,
): {
  catalog: PortTypeCatalogData;
  omittedTypes: string[];
  movedWords: { word: string; from: string; to: string }[];
} {
  if (base.kind !== 'strict')
    throw new Error(
      `base catalog of build ${base.build} is ${base.kind}; only a strict catalog can be a base`,
    );
  const build = buildOfSystemInfo(systemInfo);
  const { devices, verdicts } = readTranscript(sample);
  const all = [...devices.values()];
  const movedWords: { word: string; from: string; to: string }[] = [];
  const typeOfWord = new Map(
    Object.entries(base.types).flatMap(([type, entry]) =>
      entry.added.map((word): [string, string] => [word, type]),
    ),
  );
  for (const device of all) {
    const entry = Object.hasOwn(base.types, device.type) ? base.types[device.type] : undefined;
    if (entry === undefined) throw new Error(`type '${device.type}': not in the build ${base.build} catalog`);
    const listed = typeOfWord.get(device.word);
    if (listed !== undefined && listed !== device.type) {
      movedWords.push({ word: device.word, from: listed, to: device.type });
    }
    if (shape(device) !== shape(entry)) {
      throw new Error(`type '${device.type}': other ports than in the build ${base.build} catalog`);
    }
  }
  for (const [key, verdict] of verdicts) {
    if (verdict === 'crashed') continue;
    const [from, to] = key.split('>').map((ref) => ref.split('.')) as [string[], string[]];
    const typeOf = (id: string | undefined) => base.types[devices.get(id as string)?.type as string];
    const output = typeOf(from[0])?.outputs.find((port) => port.port === Number(from[1]));
    const input = typeOf(to[0])?.inputs.find((port) => port.port === Number(to[1]));
    const expected = (base.inputClasses[(input as PortTypeCatalogEntry).class] as readonly string[]).includes(
      (output as PortTypeCatalogEntry).class,
    )
      ? 'connected'
      : 'refused';
    if (verdict !== expected) {
      throw new Error(
        `#${key.replace('>', ' -> #')}: ${verdict} on build ${build}, but the build ${base.build} catalog says ${expected}`,
      );
    }
  }
  const types: Record<
    string,
    { added: string[]; inputs: readonly PortTypeCatalogEntry[]; outputs: readonly PortTypeCatalogEntry[] }
  > = {};
  for (const [type, entry] of Object.entries(base.types)) {
    const words = all.filter((device) => device.type === type).map((device) => device.word);
    if (words.length > 0) types[type] = { added: words, inputs: entry.inputs, outputs: entry.outputs };
  }
  return {
    catalog: {
      build,
      kind: 'sample-derived',
      outputClasses: base.outputClasses,
      inputClasses: base.inputClasses,
      types,
    },
    omittedTypes: Object.keys(base.types).filter((type) => !Object.hasOwn(types, type)),
    movedWords,
  };
}
