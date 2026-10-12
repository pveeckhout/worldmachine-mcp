// Parses the `enum-options` capture of scripts/capture-fixtures.mjs into the enum catalog of the enum-options design
// (docs/superpowers/specs/2026-10-12-worldmachine-mcp-enum-options-design.md, section 3). One module for
// scripts/build-enum-catalog.mjs and its tests, so the shipped catalog and its parity test read a transcript alike.
// Plain JavaScript because a Node script cannot import TypeScript from src/; enum-catalog.d.mts types it for tests.

// src/domain/errors.ts LOG_LINE: World Machine's log lines land inside frames (raw/enum-options.txt l.183, l.449).
const LOG_LINE = /^\[([A-Za-z]+)\s*\] /;
// src/adapter/out/worldmachine/parsers/system-info.ts VERSION (raw/system-info.txt l.3).
const VERSION = /^\s*Version:\s+Build (\d+) '[^']*'\s*$/;
// src/adapter/out/worldmachine/parsers/device-list.ts ROW: an id, the name, and an optional parenthesised kind.
const DEVICE_ROW = /^\s*#(\d+)\s+(.*?)(?:\s{2,}\(([^()]+)\))?\s*$/;
// src/adapter/out/worldmachine/parsers/param-list.ts HEADER and ROW; a device without parameters prints one line
// instead (raw/enum-options.txt l.4422).
const PARAM_HEADER = /^(Parameters for '.*' \(.*\):|Device '.*' has no parameters\.)$/;
const PARAM_ROW = /^\s{2}(\S(?:.*?\S)?)\s{2,}(\S+)(?:\s+(.*?))?\s*$/;
// Fact 84 `(0-<last>)` (l.1566), fact 86 `(0--1)` for an enum without options (l.1809).
const RANGE = /^Error: Error: Enum index out of range \(0-(-1|\d+)\): 9999$/;
const PARAM_LIST = /^param list #(\d+)$/;
const PROBE = /^param set "#(\d+)\.(.+)" 9999$/;
const SET = /^param set "#(\d+)\.(.+)" (\d+)$/;
const GET = /^param get #(\d+)\.(.+)$/;
// The scenario records a failing type or delete as its own section and goes on (capture-fixtures.mjs enumOptions).
const STOPPED = /^\((type .* stopped|scenario stopped|delete .* failed)\)$/;

/** Splits a transcript into its `>>> <command>` ... `<<<` sections; log lines and blank lines are dropped. */
function transcriptSections(text) {
  const sections = [];
  let current;
  for (const line of text.split('\n')) {
    if (line.startsWith('>>> ')) {
      current = { command: line.slice(4), lines: [] };
      sections.push(current);
    } else if (line === '<<<') {
      current = undefined;
    } else if (current !== undefined && line.trim() !== '' && !LOG_LINE.test(line)) {
      current.lines.push(line);
    }
  }
  return sections;
}

/** The build a `system info` capture reports; exactly one Version line, as parsers/system-info.ts requires. */
function buildOfSystemInfo(text) {
  const builds = text.split('\n').flatMap((line) => {
    const match = VERSION.exec(line);
    return match ? [Number(match[1])] : [];
  });
  if (builds.length !== 1) throw new Error(`system info: expected one Version line, found ${builds.length}`);
  return builds[0];
}

/**
 * The catalog `{ build, types }` of an `enum-options` transcript and the `system info` capture of the same build.
 * A type is keyed by its new device's listed type (fact 81: the kind in its `device list` row, or else its name);
 * `device info #<id>` shows the selected device, not `#<id>` (l.1548-1554), and is ignored. The label at index i is
 * the `param get` after `param set ... <i>`, trailing whitespace dropped (`#559.Method = Add `, l.1578). Anything
 * missing throws, so the catalog never has a gap.
 */
export function parseEnumCatalog(transcript, systemInfo) {
  const types = {};
  let listed = new Map();
  let device;
  let pending;
  const noGet = () => new Error(`#${device.id}.${pending.name}: no param get after index ${pending.index}`);
  const finish = () => {
    if (device === undefined) return;
    if (pending !== undefined) throw noGet();
    const entry = {};
    for (const [name, probe] of device.enums) {
      if (probe.last === undefined) throw new Error(`#${device.id}.${name}: no range error`);
      if (probe.labels.length !== probe.last + 1) {
        throw new Error(`#${device.id}.${name}: ${probe.labels.length} labels for range 0-${probe.last}`);
      }
      entry[name] = probe.labels;
    }
    if (device.enums.size > 0) {
      if (Object.hasOwn(types, device.type)) throw new Error(`type '${device.type}' captured twice`);
      types[device.type] = entry;
    }
    device = undefined;
  };
  for (const { command, lines } of transcriptSections(transcript)) {
    if (STOPPED.test(command)) throw new Error(`the capture did not complete: ${command}`);
    if (command === 'device list') {
      listed = new Map(
        lines.flatMap((line) => {
          const match = DEVICE_ROW.exec(line);
          return match ? [[match[1], match[3] ?? match[2]]] : [];
        }),
      );
      continue;
    }
    const list = PARAM_LIST.exec(command);
    if (list) {
      finish();
      const type = listed.get(list[1]);
      if (type === undefined) throw new Error(`#${list[1]}: not in the device list before its param list`);
      if (!PARAM_HEADER.test(lines[0] ?? '')) throw new Error(`${command}: unreadable header`);
      const enums = new Map();
      for (const line of lines.slice(1)) {
        const row = PARAM_ROW.exec(line);
        if (row === null) throw new Error(`${command}: unreadable row '${line}'`);
        if (row[2] === 'enum') enums.set(row[1], { last: undefined, labels: [] });
      }
      device = { id: list[1], type, enums };
      continue;
    }
    const probe = PROBE.exec(command);
    const set = probe === null ? SET.exec(command) : null;
    const get = GET.exec(command);
    const target = probe ?? set ?? get;
    if (target === null) continue;
    const enumProbe = device?.id === target[1] ? device.enums.get(target[2]) : undefined;
    if (enumProbe === undefined) throw new Error(`${command}: not an enum row of the last param list`);
    if (probe !== null) {
      const range = lines.map((line) => RANGE.exec(line.trimEnd())).find((match) => match !== null);
      if (range === undefined) throw new Error(`${command}: no range error`);
      enumProbe.last = Number(range[1]);
    } else if (set !== null) {
      if (pending !== undefined) throw noGet();
      const index = Number(set[3]);
      if (index !== enumProbe.labels.length) {
        throw new Error(`${command}: expected index ${enumProbe.labels.length}`);
      }
      pending = { name: target[2], index };
    } else if (pending?.name === target[2]) {
      // A `param get` before the probe reads the current value (l.1562-1563) and has no pending index.
      const prefix = `#${device.id}.${pending.name} = `;
      const label = lines
        .find((line) => line.startsWith(prefix))
        ?.slice(prefix.length)
        .trimEnd();
      if (label === undefined || label === '') {
        throw new Error(`${command}: no label for index ${pending.index}`);
      }
      enumProbe.labels.push(label);
      pending = undefined;
    }
  }
  finish();
  return { build: buildOfSystemInfo(systemInfo), types };
}
