import { deviceNameProblem, foldCase, idOfReference } from './device-name.js';
import { WorldMachineError } from './errors.js';
import type { ParameterValue } from './graph-edit.js';
import { decimalText } from './parameter-values.js';

/** A device entry as the MCP adapter's schema admits it; `validateGraphSpec` checks the rules (plan decision D6). */
export type RawGraphDevice = {
  readonly name: string;
  /** Revision 6: the id of an existing device the entry manages; `name` is then a label local to the spec. */
  readonly id?: number;
  readonly type: string;
  readonly enabled?: boolean;
  /** Omitted: bypass is left as it is. `device info` reports `Bypass: yes|no` (v3 spec revision 5). */
  readonly bypassed?: boolean;
  /** Revision 7: with `id`, true renames the device to `name`; refused without `id`. */
  readonly rename?: boolean;
  readonly parameters?: Readonly<Record<string, ParameterValue>>;
  readonly inputs?: Readonly<Record<string, string | null>>;
};

/** Revision 8: the current scene's settings as the MCP adapter's schema admits them (the fields of configure_scene). */
export type RawGraphScene = {
  readonly name?: string;
  readonly origin_km?: { readonly x: number; readonly y: number };
  readonly size_km?: { readonly width: number; readonly height: number };
  readonly resolution?: number;
};

/** Revision 8: the validated scene settings; each field present only when the spec gave it. */
export type GraphScene = {
  readonly name?: string;
  readonly originKm?: { readonly x: number; readonly y: number };
  readonly sizeKm?: { readonly width: number; readonly height: number };
  readonly resolution?: number;
};

export type RawGraphSpec = {
  readonly version: number;
  readonly scene?: RawGraphScene;
  readonly devices: readonly RawGraphDevice[];
  readonly remove?: readonly string[];
};

/** A wire source: a device name or `#<id>`, and its output port. */
export type GraphSource = { readonly device: string; readonly port: number };
export type GraphInput = { readonly port: number; readonly source: GraphSource | null };
export type GraphParameter = { readonly name: string; readonly value: ParameterValue };

export type GraphDevice = {
  readonly name: string;
  /** Revision 6: present only when the spec gave it; a positive integer. */
  readonly id?: number;
  readonly type: string;
  readonly enabled?: boolean;
  readonly bypassed?: boolean;
  /** Revision 7: with `id`, true renames the device to `name`; refused without `id`. */
  readonly rename?: boolean;
  /** In spec order. */
  readonly parameters: readonly GraphParameter[];
  /** Ascending by port. */
  readonly inputs: readonly GraphInput[];
};

export type GraphSpec = {
  readonly version: 1;
  readonly scene?: GraphScene;
  readonly devices: readonly GraphDevice[];
  readonly remove: readonly string[];
};

export const MAX_GRAPH_ENTRIES = 200;

/** A positive integer without leading zeros. */
const PORT = /^[1-9]\d*$/;
/** A positive integer without leading zeros that a number holds exactly. */
const isPortNumber = (digits: string): boolean => PORT.test(digits) && Number.isSafeInteger(Number(digits));
const DOTTED = /^(.*)\.(\d+)$/;

/** Plan decision D9: a trailing `.<digits>` is the output port, 1 when there is none. */
export function parseSource(text: string): GraphSource | undefined {
  const dotted = DOTTED.exec(text);
  const device = dotted?.[1] ?? text;
  const port = dotted?.[2];
  if (device === '' || device !== device.trim()) return undefined;
  if (port !== undefined && !isPortNumber(port)) return undefined;
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

/** Revision 6: an id is a positive integer, as `list_devices` shows it after the `#`. */
function checkId(device: string, id: number): number {
  if (!Number.isSafeInteger(id) || id < 1)
    refuse(`'${device}': id must be a positive whole number, not ${id}`);
  return id;
}

/** A plain decimal with at most two decimals: World Machine shows two (fact 101), so a second plan can match it. */
const TWO_DECIMALS = /^-?\d+(\.\d{1,2})?$/;

function sceneNumber(value: number, what: string, positive: boolean): number {
  const text = decimalText(value);
  if (text === undefined || !TWO_DECIMALS.test(text))
    refuse(`scene ${what} must be a plain decimal number with at most two decimals, not ${value}`);
  if (positive && !(value > 0)) refuse(`scene ${what} must be positive, not ${value}`);
  return value;
}

/** Revision 8: configure_scene's rules, and at most two decimals for the origin and the size. */
function checkScene(raw: RawGraphScene): GraphScene {
  const { name, origin_km: origin, size_km: size, resolution } = raw;
  if (name === undefined && origin === undefined && size === undefined && resolution === undefined)
    refuse('scene must give at least one of name, origin_km, size_km, and resolution');
  if (name === '') refuse('scene name must not be empty');
  if (resolution !== undefined && (!Number.isSafeInteger(resolution) || resolution < 1))
    refuse(`scene resolution must be a positive whole number, not ${resolution}`);
  return {
    ...(name === undefined ? {} : { name }),
    ...(origin === undefined
      ? {}
      : {
          originKm: {
            x: sceneNumber(origin.x, 'origin x', false),
            y: sceneNumber(origin.y, 'origin y', false),
          },
        }),
    ...(size === undefined
      ? {}
      : {
          sizeKm: {
            width: sceneNumber(size.width, 'size width', true),
            height: sceneNumber(size.height, 'size height', true),
          },
        }),
    ...(resolution === undefined ? {} : { resolution }),
  };
}

function checkParameters(
  device: string,
  parameters: Readonly<Record<string, ParameterValue>>,
): GraphParameter[] {
  return Object.entries(parameters).map(([name, value]) => {
    if (name === '') refuse(`'${device}' parameter '': the name must not be empty`);
    // v2a section 6 (fact 55): exportAlways makes every full build write files.
    if (name === 'exportAlways') refuse(`'${device}' parameter 'exportAlways': cannot be set`);
    if (typeof value === 'number' && decimalText(value) === undefined) {
      refuse(`'${device}' parameter '${name}': expected a plain decimal number, not ${value}`);
    }
    return { name, value };
  });
}

function checkInputs(device: string, inputs: Readonly<Record<string, string | null>>): GraphInput[] {
  return Object.entries(inputs)
    .map(([key, text]) => {
      if (!PORT.test(key) || !Number.isSafeInteger(Number(key)))
        refuse(`'${device}': input port '${key}' is not a positive whole number`);
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
  const scene = raw.scene === undefined ? undefined : checkScene(raw.scene);
  const remove = raw.remove ?? [];
  const entries = raw.devices.length + remove.length;
  if (entries > MAX_GRAPH_ENTRIES) {
    refuse(`devices and remove hold ${entries} entries; at most ${MAX_GRAPH_ENTRIES} are allowed`);
  }
  const names = new Map<string, string>();
  const ids = new Map<number, string>();
  const devices = raw.devices.map((entry): GraphDevice => {
    const name = checkName(entry.name);
    const earlier = names.get(foldCase(name));
    if (earlier !== undefined) refuse(`Device names '${earlier}' and '${name}' are equal regardless of case`);
    names.set(foldCase(name), name);
    const id = entry.id === undefined ? undefined : checkId(name, entry.id);
    if (id !== undefined) {
      const owner = ids.get(id);
      if (owner !== undefined) refuse(`'${owner}' and '${name}' both give id ${id}`);
      ids.set(id, name);
    }
    if (entry.rename !== undefined && id === undefined) {
      refuse(
        `'${name}': rename needs an id; an entry without id is identified by its name, so give the id of the device to rename`,
      );
    }
    return {
      name,
      ...(id === undefined ? {} : { id }),
      type: entry.type,
      ...(entry.enabled === undefined ? {} : { enabled: entry.enabled }),
      ...(entry.bypassed === undefined ? {} : { bypassed: entry.bypassed }),
      ...(entry.rename === undefined ? {} : { rename: entry.rename }),
      parameters: checkParameters(name, entry.parameters ?? {}),
      inputs: checkInputs(name, entry.inputs ?? {}),
    };
  });
  const removed = new Set<string>();
  for (const entry of remove) {
    if (entry === '') refuse('A remove entry must be a device name or #<id>, not empty');
    if (idOfReference(entry) === undefined) {
      const problem = deviceNameProblem(entry);
      if (problem !== undefined) refuse(`Remove entry '${entry}' must not ${problem}`);
    }
    const key = foldCase(entry);
    if (names.has(key))
      refuse(
        `'${entry}' is in both devices and remove; to remove a device whose name an entry uses as its label, give the device as #<id>`,
      );
    const removedId = idOfReference(entry);
    const owner = removedId === undefined ? undefined : ids.get(removedId);
    if (owner !== undefined) refuse(`'${entry}' in remove is the id of '${owner}'`);
    if (removed.has(key)) refuse(`'${entry}' appears twice in remove`);
    removed.add(key);
  }
  return { version: 1, ...(scene === undefined ? {} : { scene }), devices, remove: [...remove] };
}
