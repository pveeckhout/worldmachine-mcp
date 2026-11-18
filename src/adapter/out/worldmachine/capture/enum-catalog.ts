// Parses the `enum-options` capture of scripts/capture-fixtures.mjs into the enum catalog of the enum-options design
// (docs/superpowers/specs/2026-10-12-worldmachine-mcp-enum-options-design.md, section 3). One module for
// scripts/build-enum-catalog.mjs and its tests, so the shipped catalog and its parity test read a transcript alike.
// port-type-catalog.ts reuses its transcript and system info readers (port-types plan decision D19).
import { LOG_LINE } from '../../../../domain/errors.js';
import { buildOfSystemInfo, transcriptSections } from './transcript.js';

// src/domain/errors.ts LOG_LINE: World Machine's log lines land inside frames (raw/enum-options.txt l.183, l.449).
export { LOG_LINE };

// src/adapter/out/worldmachine/parsers/device-list.ts ROW: an id, the name, and an optional parenthesised kind.
const DEVICE_ROW = /^\s*#(\d+)\s+(.*?)(?:\s{2,}\(([^()]+)\))?\s*$/;
// src/adapter/out/worldmachine/parsers/param-list.ts HEADER and ROW; a device without parameters prints one line
// instead (raw/enum-options.txt l.4422).
const PARAM_HEADER = /^(Parameters for '.*' \(.*\):|Device '.*' has no parameters\.)$/;
const PARAM_ROW = /^\s{2}(\S(?:.*?\S)??)\s{2,}(\S+)(?:\s+(.*?))?\s*$/;
// Fact 84 `(0-<last>)` (l.1566), fact 86 `(0--1)` for an enum without options (l.1809).
const RANGE = /^Error: Error: Enum index out of range \(0-(-1|\d+)\): 9999$/;
const PARAM_LIST = /^param list #(\d+)$/;
const PROBE = /^param set "#(\d+)\.(.+)" 9999$/;
const SET = /^param set "#(\d+)\.(.+)" (\d+)$/;
const GET = /^param get #(\d+)\.(.+)$/;
const ADD = /^device add (.+)$/;
// Build 4069 refuses an add word that names several device types (wm-4069/raw/enum-options.txt l.966).
const AMBIGUOUS_ADD = /^Error: Error: (Tag '.*' matches multiple devices: .*)$/;
// The scenario records a failing type or delete as its own section and goes on (capture-fixtures.mjs enumOptions).
const STOPPED = /^\((type .* stopped|scenario stopped|delete .* failed)\)$/;

/** One type of the catalog; the mutable form of EnumCatalog's entries. */
export type EnumCatalogEntry = { parameters: string[]; enums: Record<string, string[]> };
export type EnumCatalogData = { build: number; types: Record<string, EnumCatalogEntry> };
export type RefusedAdd = { word: string; reason: string };

type Probe = { last: number | undefined; labels: string[] };
type ParamDevice = { id: string; type: string; parameters: string[]; enums: Map<string, Probe> };

/**
 * The catalog `{ build, types }`, a type being `{ parameters, enums }` (every row name of the new device's `param list`
 * in printed order, and the options of each enum row), of an `enum-options` transcript and the `system info` capture of the same build.
 * A type is keyed by its new device's listed type (fact 81: the kind in its `device list` row, or else its name);
 * `device info #<id>` shows the selected device, not `#<id>` (l.1548-1554), and is ignored. The label at index i is
 * the `param get` after `param set ... <i>`, trailing whitespace dropped (`#559.Method = Add `, l.1578). Anything
 * missing throws, so the catalog never has a gap.
 */
export function parseEnumCatalog(transcript: string, systemInfo: string): EnumCatalogData {
  return parseEnumCapture(transcript, systemInfo).catalog;
}

/**
 * `{ catalog, refusedAdds }`: the catalog of parseEnumCatalog, and each `device add` World Machine refused because its
 * word matches several device types, as `{ word, reason }`. Such an add adds no device and is skipped; every other add
 * that adds no device still throws.
 */
export function parseEnumCapture(
  transcript: string,
  systemInfo: string,
): { catalog: EnumCatalogData; refusedAdds: RefusedAdd[] } {
  const types: Record<string, EnumCatalogEntry> = {};
  const refusedAdds: RefusedAdd[] = [];
  let listed = new Map<string, string>();
  let device: ParamDevice | undefined;
  let pending: { name: string; index: number } | undefined;
  // The `device add` whose device has to show up in the next `device list` and `param list` (spec section 3).
  let adding: { word: string; before: Map<string, string>; added: string[] | undefined } | undefined;
  const noGet = () =>
    new Error(`#${device?.id}.${pending?.name}: no param get after index ${pending?.index}`);
  const finish = () => {
    if (device === undefined) return;
    if (pending !== undefined) throw noGet();
    const entry: Record<string, string[]> = {};
    for (const [name, probe] of device.enums) {
      if (probe.last === undefined) throw new Error(`#${device.id}.${name}: no range error`);
      if (probe.labels.length !== probe.last + 1) {
        throw new Error(`#${device.id}.${name}: ${probe.labels.length} labels for range 0-${probe.last}`);
      }
      entry[name] = probe.labels;
    }
    if (device.enums.size > 0) {
      if (Object.hasOwn(types, device.type)) throw new Error(`type '${device.type}' captured twice`);
      types[device.type] = { parameters: device.parameters, enums: entry };
    }
    device = undefined;
  };
  for (const { command, lines } of transcriptSections(transcript)) {
    if (STOPPED.test(command)) throw new Error(`the capture did not complete: ${command}`);
    const add = ADD.exec(command);
    if (add) {
      if (adding !== undefined) throw new Error(`device add ${adding.word}: no param list of its device`);
      const refusal = lines.map((line) => AMBIGUOUS_ADD.exec(line.trimEnd())).find((match) => match !== null);
      if (refusal !== undefined && refusal !== null) {
        refusedAdds.push({ word: add[1] as string, reason: refusal[1] as string });
        continue;
      }
      adding = { word: add[1] as string, before: listed, added: undefined };
      continue;
    }
    if (command === 'device list') {
      const before = listed;
      listed = new Map(
        lines.flatMap((line): [string, string][] => {
          const match = DEVICE_ROW.exec(line);
          return match ? [[match[1] as string, (match[3] ?? match[2]) as string]] : [];
        }),
      );
      if (adding !== undefined) {
        adding.added = [...listed.keys()].filter((id) => !before.has(id));
        if (adding.added.length === 0)
          throw new Error(`device add ${adding.word}: no new device in the device list`);
      }
      continue;
    }
    const list = PARAM_LIST.exec(command);
    if (list) {
      finish();
      if (adding !== undefined) {
        if (!adding.added?.includes(list[1] as string)) {
          throw new Error(`device add ${adding.word}: ${command} does not name a new device`);
        }
        adding = undefined;
      }
      const type = listed.get(list[1] as string);
      if (type === undefined) throw new Error(`#${list[1]}: not in the device list before its param list`);
      if (!PARAM_HEADER.test(lines[0] ?? '')) throw new Error(`${command}: unreadable header`);
      const enums = new Map<string, Probe>();
      const parameters: string[] = [];
      for (const line of lines.slice(1)) {
        const row = PARAM_ROW.exec(line);
        if (row === null) throw new Error(`${command}: unreadable row '${line}'`);
        parameters.push(row[1] as string);
        if (row[2] === 'enum') enums.set(row[1] as string, { last: undefined, labels: [] });
      }
      device = { id: list[1] as string, type, parameters, enums };
      continue;
    }
    const probe = PROBE.exec(command);
    const set = probe === null ? SET.exec(command) : null;
    const get = GET.exec(command);
    const target = probe ?? set ?? get;
    if (target === null) continue;
    const id = target[1] as string;
    const name = target[2] as string;
    const owner = device?.id === id ? device : undefined;
    const enumProbe = owner?.enums.get(name);
    if (owner === undefined || enumProbe === undefined)
      throw new Error(`${command}: not an enum row of the last param list`);
    if (probe !== null) {
      const range = lines.map((line) => RANGE.exec(line.trimEnd())).find((match) => match !== null);
      if (range === undefined) throw new Error(`${command}: no range error`);
      enumProbe.last = Number(range?.[1]);
    } else if (set !== null) {
      if (pending !== undefined) throw noGet();
      const index = Number(set[3]);
      // A refused set leaves the value unchanged, so its `param get` would record the previous label (l.1569).
      if (lines.length !== 1 || lines[0]?.trimEnd() !== `Set #${id}.${name} = ${index}`) {
        throw new Error(
          `type '${owner.type}', parameter '${name}': param set to index ${index} not confirmed: ${lines.join(' ')}`,
        );
      }
      if (index !== enumProbe.labels.length) {
        throw new Error(`${command}: expected index ${enumProbe.labels.length}`);
      }
      pending = { name, index };
    } else if (pending !== undefined && pending.name === name) {
      // A `param get` before the probe reads the current value (l.1562-1563) and has no pending index.
      const prefix = `#${owner.id}.${pending.name} = `;
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
  if (adding !== undefined) throw new Error(`device add ${adding.word}: no param list of its device`);
  return { catalog: { build: buildOfSystemInfo(systemInfo), types }, refusedAdds };
}
