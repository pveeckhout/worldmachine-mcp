// A World Machine console in memory, for the catalog capturer. Its replies are cut from the build 4069 captures
// (test/fixtures/wm-4069/raw/enum-options.txt and port-types-sample.txt): which word adds which device, the refusals,
// and each type's `param list`. Enum labels come from the 4069 enum catalog, ports and their classes from the 4069
// port-type catalog (else the 4067 one, for the types 4069 could not sample).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transcriptSections } from '../../src/adapter/out/worldmachine/capture/transcript.js';
import { ENUM_CATALOG_4069 } from '../../src/adapter/out/worldmachine/enum-options.js';
import {
  PORT_TYPE_CATALOG_4067,
  PORT_TYPE_CATALOG_4069,
} from '../../src/adapter/out/worldmachine/world-machine-port-types.js';
import type { ConsoleReply, SessionLease } from '../../src/application/port/out/lease-session-port.js';
import type { PortTypeCatalog } from '../../src/domain/catalog.js';
import { WorldMachineError } from '../../src/domain/errors.js';

const RAW = fileURLToPath(new URL('../fixtures/wm-4069/raw/', import.meta.url));
const raw = (name: string): string => readFileSync(`${RAW}${name}`, 'utf8');

export const SYSTEM_INFO_4069: readonly string[] = transcriptSections(raw('system-info.txt'))[0]?.lines ?? [];

const ROW = /^\s*#(\d+)\s+(.*?)(?:\s{2,}\(([^()]+)\))?\s*$/;
type Listed = { readonly name: string; readonly kind?: string };
const rows = (lines: readonly string[]): Map<string, Listed> =>
  new Map(
    lines.flatMap((line): [string, Listed][] => {
      const match = ROW.exec(line);
      if (match === null) return [];
      return [[match[1] as string, { name: match[2] as string, ...(match[3] ? { kind: match[3] } : {}) }]];
    }),
  );
const typeOf = (listed: Listed): string => listed.kind ?? listed.name;

type WordReply = { readonly added: Listed } | { readonly lines: readonly string[] };

/** What each word did on build 4069, and each listed type's `param list` lines (without the header). */
function cutFixtures(): { words: Map<string, WordReply>; params: Map<string, string[]> } {
  const words = new Map<string, WordReply>();
  const params = new Map<string, string[]>();
  for (const file of ['enum-options.txt', 'port-types-sample.txt']) {
    let listed = new Map<string, Listed>();
    let adding: { word: string; lines: string[] } | undefined;
    for (const { command, lines } of transcriptSections(raw(file))) {
      if (command.startsWith('device add ')) {
        adding = { word: command.slice('device add '.length), lines };
      } else if (command === 'device list') {
        const now = rows(lines);
        if (adding !== undefined) {
          const fresh = [...now].filter(([id]) => !listed.has(id));
          const known = words.get(adding.word);
          if (fresh.length === 1) words.set(adding.word, { added: (fresh[0] as [string, Listed])[1] });
          else if (known === undefined) words.set(adding.word, { lines: adding.lines });
          adding = undefined;
        }
        listed = now;
      } else if (command.startsWith('param list #')) {
        const device = listed.get(command.slice('param list #'.length));
        if (device !== undefined) params.set(typeOf(device), lines.slice(1));
      }
    }
  }
  // A listed type is added by its own name as well.
  for (const reply of [...words.values()]) {
    if ('added' in reply) {
      const name = typeOf(reply.added);
      if (!words.has(name)) words.set(name, { added: { name } });
    }
  }
  return { words, params };
}

const FIXTURES = cutFixtures();

type Device = { id: number; listed: Listed; values: Map<string, number> };
type Wire = { from: number; fromPort: number };

const portsOf = (
  type: string,
): {
  catalog: PortTypeCatalog | undefined;
  inputs: { port: number; name: string; class: string }[];
  outputs: { port: number; name: string; class: string }[];
} => {
  for (const catalog of [PORT_TYPE_CATALOG_4069, PORT_TYPE_CATALOG_4067]) {
    const entry = catalog.types[type];
    if (entry !== undefined) return { catalog, inputs: [...entry.inputs], outputs: [...entry.outputs] };
  }
  return { catalog: undefined, inputs: [], outputs: [] };
};

export type SimulatedConsoleOptions = {
  /** The build `system info` reports. */
  readonly build?: number;
  /** Rejects this batch, and every later one, with CRASHED; given the batch's commands and its index. */
  readonly crashWhen?: (commands: readonly string[], index: number) => boolean;
};

/** One simulated World Machine and a lease on it; `batches` records every batch sent, `crashed` once it crashed. */
export function simulatedConsole(options: SimulatedConsoleOptions = {}) {
  const build = options.build ?? 4069;
  const systemInfo = SYSTEM_INFO_4069.map((line) => line.replace(/Build \d+/, `Build ${build}`));
  const batches: string[][] = [];
  let devices: Device[] = [];
  let next = 1;
  let wires = new Map<string, Wire>();
  let crashed = false;
  let released = 0;
  let freshBinds = 0;

  const out = (command: string, ...output: string[]): ConsoleReply => ({ command, output, errors: [] });
  const err = (command: string, ...errors: string[]): ConsoleReply => ({ command, output: [], errors });
  const device = (id: string | number) => devices.find((d) => d.id === Number(id));

  const answer = (command: string): ConsoleReply => {
    if (command === 'project new blank force' || command === 'project close force') {
      devices = [];
      wires = new Map();
      next = 1;
      return out(
        command,
        command.startsWith('project new') ? 'Created new blank project.' : 'Project closed.',
      );
    }
    if (command === 'system info') return out(command, ...systemInfo);
    if (command === 'device list') {
      if (devices.length === 0) return out(command, 'No devices in the current project.');
      return out(
        command,
        `Devices (${devices.length} total):`,
        ...devices.map(
          (d) =>
            `  #${String(d.id).padEnd(6)}${d.listed.name.padEnd(24)}${d.listed.kind ? ` (${d.listed.kind})` : ''}`,
        ),
      );
    }
    if (command.startsWith('device add ')) {
      const reply = FIXTURES.words.get(command.slice('device add '.length));
      if (reply === undefined)
        return err(command, `Error: Error: Device type not found: '${command.slice(11)}'`);
      if ('lines' in reply) return err(command, ...reply.lines);
      devices.push({ id: next++, listed: reply.added, values: new Map() });
      return out(command, `Added '${reply.added.name}'`);
    }
    let match = /^device delete #(\d+)$/.exec(command);
    if (match) {
      devices = devices.filter((d) => d.id !== Number(match?.[1]));
      return out(command, `Deleted: #${match[1]}`);
    }
    match = /^param list #(\d+)$/.exec(command);
    if (match) {
      const d = device(match[1] as string);
      if (d === undefined) return err(command, 'Error: Error: no such device');
      const lines = FIXTURES.params.get(typeOf(d.listed));
      if (lines === undefined || lines.length === 0)
        return out(command, `Device '${d.listed.name}' has no parameters.`);
      return out(command, `Parameters for '${d.listed.name}' (${typeOf(d.listed)}):`, ...lines);
    }
    const labelsOf = (d: Device, name: string) =>
      ENUM_CATALOG_4069.types[typeOf(d.listed)]?.enums[name] ?? [];
    match = /^param get #(\d+)\.(.+)$/.exec(command);
    if (match) {
      const d = device(match[1] as string);
      const name = match[2] as string;
      if (d === undefined) return err(command, 'Error: Error: no such device');
      return out(command, `#${d.id}.${name} = ${labelsOf(d, name)[d.values.get(name) ?? 0] ?? ''}`);
    }
    match = /^param set "#(\d+)\.(.+)" (\d+)$/.exec(command);
    if (match) {
      const d = device(match[1] as string);
      const name = match[2] as string;
      const index = Number(match[3]);
      if (d === undefined) return err(command, 'Error: Error: no such device');
      const labels = labelsOf(d, name);
      if (index >= labels.length)
        return err(command, `Error: Error: Enum index out of range (0-${labels.length - 1}): ${index}`);
      d.values.set(name, index);
      return out(command, `Set #${d.id}.${name} = ${index}`);
    }
    match = /^wire list #(\d+)$/.exec(command);
    if (match) {
      const d = device(match[1] as string);
      if (d === undefined) return err(command, 'Error: Error: no such device');
      const { inputs, outputs } = portsOf(typeOf(d.listed));
      return out(
        command,
        `Connections for '#${d.id}':`,
        '  Inputs:',
        ...inputs.map((input) => {
          const wire = wires.get(`${d.id}.${input.port}`);
          const source =
            wire === undefined ? '(none)' : `'${device(wire.from)?.listed.name}' [${wire.fromPort}]`;
          return `    [${input.port}] ${input.name} <- ${source}`;
        }),
        '  Outputs:',
        ...outputs.map((output) => `    [${output.port}] ${output.name} -> (none)`),
      );
    }
    match = /^wire (connect|disconnect) #(\d+)\.(\d+) #(\d+)\.(\d+)$/.exec(command);
    if (match) {
      const [, verb, from, fromPort, to, toPort] = match as unknown as [
        string,
        string,
        string,
        string,
        string,
        string,
      ];
      const ends = `'#${from}' [${fromPort}] -> '#${to}' [${toPort}]`;
      const key = `${to}.${toPort}`;
      if (verb === 'disconnect') {
        const wire = wires.get(key);
        if (wire?.from === Number(from) && wire.fromPort === Number(fromPort)) wires.delete(key);
        return out(command, `Disconnected ${ends}`);
      }
      const source = device(from);
      const target = device(to);
      if (source === undefined || target === undefined) return err(command, 'Error: Error: no such device');
      const output = portsOf(typeOf(source.listed));
      const input = portsOf(typeOf(target.listed));
      const outClass = output.outputs.find((p) => p.port === Number(fromPort))?.class;
      const inClass = input.inputs.find((p) => p.port === Number(toPort))?.class;
      const accepts =
        outClass === undefined || inClass === undefined || input.catalog === undefined
          ? true
          : (input.catalog.inputClasses[inClass] ?? []).includes(outClass);
      if (!accepts) return err(command, 'Error: Error: Failed to create connection (incompatible types?)');
      wires.set(key, { from: Number(from), fromPort: Number(fromPort) });
      return out(command, `Connected ${ends}`);
    }
    return err(command, `Error: Unknown command: '${command}'`);
  };

  const lease: SessionLease = {
    execute: async (commands) => {
      const index = batches.length;
      batches.push([...commands]);
      if (crashed || options.crashWhen?.(commands, index)) {
        crashed = true;
        throw new WorldMachineError('CRASHED', 'World Machine exited unexpectedly');
      }
      return commands.map(answer);
    },
    bindFresh: () => {
      freshBinds++;
    },
    release: () => {
      released++;
    },
  };
  return {
    lease,
    batches,
    sent: () => batches.flat(),
    crashed: () => crashed,
    freshBinds: () => freshBinds,
    released: () => released,
  };
}
