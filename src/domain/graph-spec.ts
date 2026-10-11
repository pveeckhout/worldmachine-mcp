import { deviceNameProblem, foldCase } from './device-name.js';
import { WorldMachineError } from './errors.js';
import type { ParameterValue } from './graph-edit.js';
import { decimalText } from './parameter-values.js';

/** A device entry as the MCP adapter's schema admits it; `validateGraphSpec` checks the rules (plan decision D6). */
export type RawGraphDevice = {
  readonly name: string;
  readonly type: string;
  readonly enabled?: boolean;
  readonly parameters?: Readonly<Record<string, ParameterValue>>;
  readonly inputs?: Readonly<Record<string, string | null>>;
};

export type RawGraphSpec = {
  readonly version: number;
  readonly devices: readonly RawGraphDevice[];
  readonly remove?: readonly string[];
};

/** A wire source: a device name or `#<id>`, and its output port. */
export type GraphSource = { readonly device: string; readonly port: number };
export type GraphInput = { readonly port: number; readonly source: GraphSource | null };
export type GraphParameter = { readonly name: string; readonly value: ParameterValue };

export type GraphDevice = {
  readonly name: string;
  readonly type: string;
  readonly enabled?: boolean;
  /** In spec order. */
  readonly parameters: readonly GraphParameter[];
  /** Ascending by port. */
  readonly inputs: readonly GraphInput[];
};

export type GraphSpec = {
  readonly version: 1;
  readonly devices: readonly GraphDevice[];
  readonly remove: readonly string[];
};

export const MAX_GRAPH_ENTRIES = 200;

/** A positive integer without leading zeros. */
const PORT = /^[1-9]\d*$/;
const DOTTED = /^(.*)\.(\d+)$/;

/** Plan decision D9: a trailing `.<digits>` is the output port, 1 when there is none. */
export function parseSource(text: string): GraphSource | undefined {
  const dotted = DOTTED.exec(text);
  const device = dotted?.[1] ?? text;
  const port = dotted?.[2];
  if (device === '' || device !== device.trim()) return undefined;
  if (port !== undefined && !PORT.test(port)) return undefined;
  return { device, port: port === undefined ? 1 : Number(port) };
}

function refuse(message: string): never {
  throw new WorldMachineError('REFUSED', message);
}

function checkName(name: string): string {
  if (name === '') refuse('A device name must not be empty');
  const problem = deviceNameProblem(name);
  if (problem !== undefined) refuse(`Device name '${name}' must not ${problem}`);
  return name;
}

function checkParameters(
  device: string,
  parameters: Readonly<Record<string, ParameterValue>>,
): GraphParameter[] {
  return Object.entries(parameters).map(([name, value]) => {
    if (name === '') refuse(`'${device}' has a parameter with an empty name`);
    // v2a section 6 (fact 55): exportAlways makes every full build write files.
    if (name === 'exportAlways') refuse(`'${device}': exportAlways cannot be set`);
    if (typeof value === 'number' && decimalText(value) === undefined) {
      refuse(`'${device}' parameter '${name}': expected a plain decimal number, not ${value}`);
    }
    return { name, value };
  });
}

function checkInputs(device: string, inputs: Readonly<Record<string, string | null>>): GraphInput[] {
  return Object.entries(inputs)
    .map(([key, text]) => {
      if (!PORT.test(key)) refuse(`'${device}': input port '${key}' is not a positive whole number`);
      if (text === null) return { port: Number(key), source: null };
      const source = parseSource(text);
      if (source === undefined) {
        refuse(`'${device}' input ${key}: source '${text}' is not "<device>" or "<device>.<port>"`);
      }
      return { port: Number(key), source };
    })
    .sort((a, b) => a.port - b.port);
}

/** Spec v3 section 4: every rule that needs no World Machine read; refused with `REFUSED` before any command. */
export function validateGraphSpec(raw: RawGraphSpec): GraphSpec {
  if (raw.version !== 1) refuse(`The spec version must be 1, not ${raw.version}`);
  const remove = raw.remove ?? [];
  const entries = raw.devices.length + remove.length;
  if (entries > MAX_GRAPH_ENTRIES) {
    refuse(`devices and remove hold ${entries} entries; at most ${MAX_GRAPH_ENTRIES} are allowed`);
  }
  const names = new Map<string, string>();
  const devices = raw.devices.map((entry): GraphDevice => {
    const name = checkName(entry.name);
    const earlier = names.get(foldCase(name));
    if (earlier !== undefined) refuse(`Device names '${earlier}' and '${name}' are equal regardless of case`);
    names.set(foldCase(name), name);
    return {
      name,
      type: entry.type,
      ...(entry.enabled === undefined ? {} : { enabled: entry.enabled }),
      parameters: checkParameters(name, entry.parameters ?? {}),
      inputs: checkInputs(name, entry.inputs ?? {}),
    };
  });
  const removed = new Set<string>();
  for (const entry of remove) {
    if (entry === '') refuse('A remove entry must be a device name or #<id>, not empty');
    const key = foldCase(entry);
    if (names.has(key)) refuse(`'${entry}' is in both devices and remove`);
    if (removed.has(key)) refuse(`'${entry}' appears twice in remove`);
    removed.add(key);
  }
  return { version: 1, devices, remove: [...remove] };
}
