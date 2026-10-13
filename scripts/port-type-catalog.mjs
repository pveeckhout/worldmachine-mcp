// Parses the `port-types` capture of scripts/capture-fixtures.mjs into the port-type catalog of the port-types design
// (docs/superpowers/specs/2026-10-13-worldmachine-mcp-port-types-design.md, section 4). One module for
// scripts/build-port-type-catalog.mjs and its tests, so the shipped catalog and its parity test read a transcript alike.
// Plain JavaScript because a Node script cannot import TypeScript from src/; port-type-catalog.d.mts types it for tests.
import { buildOfSystemInfo, transcriptSections } from './enum-catalog.mjs';
import { DEVICE_ROW, readWireList } from './wire-list.mjs';

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
const VERDICT = /^#(\d+)\.(\d+) (connected|refused(?: stray(?: #\d+\.\d+)+)?|error: .*)$/;
// Plan decision D13: a type, a probe, or the whole scenario that threw is recorded as its own section.
const STOPPED = /^\((type .* stopped|probe .* stopped|scenario stopped)\)$/;

/** A port for messages: `'<type>.<name>'`. */
const named = (port) => `'${port.device.type}.${port.name}'`;
/** Design section 4: a class without a names entry is named by its first port in catalog order. */
const like = (portClass) => `like ${portClass.members[0].device.type} ${portClass.members[0].name}`;

/** One `(probe #<id>.<port>)` section (plan decision D11): a verdict per input of every other device. */
function readProbe(command, lines, sourceId, port, devices, cells) {
  if (!devices.get(sourceId)?.outputs?.some((output) => output.port === port)) {
    throw new Error(`${command}: not an output of a listed device`);
  }
  for (const line of lines) {
    const verdict = VERDICT.exec(line);
    if (verdict === null) throw new Error(`${command}: unreadable line '${line}'`);
    const pair = `#${sourceId}.${port} -> #${verdict[1]}.${verdict[2]}`;
    if (verdict[1] === sourceId) throw new Error(`${pair}: a pair on one device`);
    if (!devices.get(verdict[1])?.inputs?.some((input) => input.port === Number(verdict[2]))) {
      throw new Error(`${pair}: not an input of a listed device`);
    }
    // Design section 4: no catalog rests on an unexplained answer.
    if (verdict[3].startsWith('error: ')) throw new Error(`${pair}: ${verdict[3].slice('error: '.length)}`);
    // Codex round 1 ruling B2: a refusal that left a wire contradicts design section 2, so it fails as well.
    if (verdict[3].startsWith('refused stray')) throw new Error(`${pair}: ${verdict[3]}`);
    const key = `${sourceId}.${port}>${verdict[1]}.${verdict[2]}`;
    if (cells.has(key)) throw new Error(`${pair}: probed twice`);
    cells.set(key, verdict[3] === 'connected');
  }
}

/**
 * Design section 4, plan decision D14: ports whose cells agree wherever both are known form one class. Greedy in
 * catalog order, then every port is matched against the final classes, so a port that matches two classes fails and
 * a hole never decides a class. `cellsOf(port)` maps the other side's port keys to true (connected) or false.
 */
function classify(ports, cellsOf, prefix, kind) {
  const classes = [];
  const matching = (cells) =>
    classes.filter((portClass) =>
      [...cells].every(([key, value]) => !portClass.cells.has(key) || portClass.cells.get(key) === value),
    );
  const ambiguous = (port, found) =>
    new Error(`${kind} ${named(port)} matches ${found.length} classes: ${found.map(like).join(', ')}`);
  for (const port of ports) {
    const cells = cellsOf(port);
    const found = matching(cells);
    if (found.length > 1) throw ambiguous(port, found);
    const portClass = found[0] ?? { id: `${prefix}${classes.length + 1}`, members: [], cells: new Map() };
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
function accepts(outputClass, inputClass, cells) {
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
function classNames(outputClasses, outputs, names) {
  const classOf = new Map(
    outputClasses.flatMap((outputClass) => outputClass.members.map((output) => [output.key, outputClass.id])),
  );
  const entries = new Map();
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
 * The catalog `{ build, outputClasses, inputClasses, types }` of a `port-types` transcript and the `system info`
 * capture of the same build, the classes named by `names` (design section 4, plan decisions D4 and D14). A type is keyed by its new device's listed type
 * (fact 81: the kind in its `device list` row, or else its name), with every `device add` word that gave it (`added`,
 * Codex round 1 ruling B1) and its ports in `wire list` order with their class ids.
 * A pair on one device was never probed, so its cell is unknown and ignored. A stopped step, an error answer, a
 * refusal recorded with a stray wire, a gap, or a port that matches two classes throws, so the catalog never rests on
 * a hole.
 */
export function parsePortTypeCatalog(transcript, systemInfo, names = {}) {
  const build = buildOfSystemInfo(systemInfo);
  /** Ids to listed types of the last `device list`. */
  let listed = new Map();
  /** The `device add` whose device has to show up in the next `device list`, or be recorded as not added. */
  let adding;
  /** True from `project new blank force` until the device list after it. */
  let blank = false;
  /** Added devices by id, in transcript order: `{ id, type, word, inputs, outputs }`, ports from their wire list. */
  const devices = new Map();
  /** `<output id>.<port>><input id>.<port>` to true (connected) or false (refused). */
  const cells = new Map();
  for (const { command, lines } of transcriptSections(transcript)) {
    if (STOPPED.test(command)) throw new Error(`the capture did not complete: ${command}`);
    const add = ADD.exec(command);
    if (add) {
      if (adding !== undefined)
        throw new Error(`device add ${adding.word}: no new device and no not-added record`);
      adding = { word: add[1], before: listed };
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
      const empty = lines.length === 1 && lines[0].trimEnd() === NO_DEVICES;
      // Codex round 2 ruling 1: every row must read, so no device is missed.
      const [header, ...rows] = empty ? [] : lines;
      if (!empty && !DEVICE_LIST_HEADER.test(header ?? '')) {
        throw new Error(`device list: unreadable header '${header}'`);
      }
      const unreadable = rows.find((line) => !DEVICE_ROW.test(line));
      if (unreadable !== undefined) throw new Error(`device list: unreadable row '${unreadable}'`);
      listed = new Map(
        rows.map((line) => {
          const match = DEVICE_ROW.exec(line);
          return [match[1], match[3] ?? match[2]];
        }),
      );
      if (blank) {
        blank = false;
        if (!empty) throw new Error(`device list after project new blank force: not '${NO_DEVICES}'`);
      }
      if (adding === undefined) continue;
      const fresh = [...listed.keys()].filter((id) => !adding.before.has(id));
      if (fresh.length > 1)
        throw new Error(`device add ${adding.word}: ${fresh.length} new devices in the device list`);
      if (fresh.length === 0) continue;
      // Codex round 1 ruling B1: the add word is kept; several words may give one listed type (raw/v3-rename-types.txt).
      devices.set(fresh[0], {
        id: fresh[0],
        type: listed.get(fresh[0]),
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
      const device = devices.get(list[1]);
      if (device === undefined) throw new Error(`${command}: not a device the capture added`);
      if (device.inputs !== undefined) throw new Error(`${command}: listed twice`);
      Object.assign(device, readWireList(command, lines));
      continue;
    }
    const probe = PROBE.exec(command);
    if (probe) readProbe(command, lines, probe[1], Number(probe[2]), devices, cells);
  }
  if (adding !== undefined)
    throw new Error(`device add ${adding.word}: no new device and no not-added record`);
  const all = [...devices.values()];
  for (const device of all) {
    if (device.inputs === undefined) throw new Error(`#${device.id} '${device.type}': no wire list`);
  }
  // B1 addendum ruling: only the first device of each listed type is probed; every other word that gave the type is
  // in `added` when its device shows the same port names, and fails the generation otherwise.
  const catalogued = all.filter(
    (device, index) => all.findIndex((other) => other.type === device.type) === index,
  );
  const shape = (device) =>
    JSON.stringify(
      [device.inputs, device.outputs].map((ports) => ports.map(({ port, name }) => [port, name])),
    );
  for (const device of all) {
    const probed = catalogued.find((candidate) => candidate.type === device.type);
    if (shape(device) !== shape(probed)) {
      throw new Error(`type '${device.type}': '${device.word}' gives other ports than '${probed.word}'`);
    }
  }
  for (const key of cells.keys()) {
    const [from, to] = key.split('>').map((ref) => ref.split('.')[0]);
    if (!catalogued.some((device) => device.id === from) || !catalogued.some((device) => device.id === to)) {
      throw new Error(`#${key.replace('>', ' -> #')}: a device that is not the probed one of its type`);
    }
  }
  const portsOf = (kind) =>
    catalogued.flatMap((device) =>
      device[kind].map((port) => ({ device, ...port, key: `${device.id}.${port.port}` })),
    );
  const outputs = portsOf('outputs');
  const inputs = portsOf('inputs');
  for (const output of outputs) {
    for (const input of inputs) {
      if (output.device !== input.device && !cells.has(`${output.key}>${input.key}`)) {
        throw new Error(`#${output.key} -> #${input.key}: not probed`);
      }
    }
  }
  const rowOf = (output) =>
    new Map(
      inputs
        .filter((input) => input.device !== output.device)
        .map((input) => [input.key, cells.get(`${output.key}>${input.key}`)]),
    );
  const columnOf = (input) =>
    new Map(
      outputs
        .filter((output) => output.device !== input.device)
        .map((output) => [output.key, cells.get(`${output.key}>${input.key}`)]),
    );
  const outputClasses = classify(outputs, rowOf, 'o', 'output');
  const inputClasses = classify(inputs, columnOf, 'i', 'input');
  const classIndex = (classes) =>
    new Map(classes.flatMap((portClass) => portClass.members.map((port) => [port.key, portClass.id])));
  const outputClassOf = classIndex(outputClasses);
  const inputClassOf = classIndex(inputClasses);
  const types = {};
  for (const device of catalogued) {
    types[device.type] = {
      // Codex round 1 ruling B1 and its addendum: every accepted add word that gave this type, in transcript order.
      added: all.filter((other) => other.type === device.type).map((other) => other.word),
      inputs: device.inputs.map(({ port, name }) => ({
        port,
        name,
        class: inputClassOf.get(`${device.id}.${port}`),
      })),
      outputs: device.outputs.map(({ port, name }) => ({
        port,
        name,
        class: outputClassOf.get(`${device.id}.${port}`),
      })),
    };
  }
  return {
    build,
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
