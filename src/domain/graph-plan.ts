import { createHash } from 'node:crypto';
import type { DeviceDetail, DeviceSummary, InputPort, OutputPort, Parameter, PortLink } from './device.js';
import { foldCase, idOfReference, listedName } from './device-name.js';
import type { ParameterValue } from './graph-edit.js';
import type { GraphDevice, GraphSource, GraphSpec } from './graph-spec.js';
import { decimalText, parameterText } from './parameter-values.js';
import { candidateIds, resolveWireSource, sharedNameClause, sourceCandidates } from './wire-source.js';

/** What `planGraph` reads: the device list and `get_device` of every device `referencedDeviceIds` names. */
export type GraphState = {
  /** The open project's path; null for a project never saved. */
  readonly projectPath: string | null;
  readonly devices: readonly DeviceSummary[];
  readonly details: readonly DeviceDetail[];
};

/** A wire's source in a step: the name the plan shows, the id when the device exists already (D8), and the port. */
export type StepSource = { readonly device: string; readonly id?: number; readonly port: number };

export type PlanStep =
  | {
      readonly op: 'disconnect';
      readonly device: string;
      readonly id: number;
      readonly port: number;
      readonly from: string;
      readonly source: StepSource & { readonly id: number };
    }
  | {
      readonly op: 'remove';
      readonly device: string;
      readonly id: number;
      readonly wiresRemoved: readonly string[];
    }
  | { readonly op: 'add'; readonly device: string; readonly type: string }
  | {
      readonly op: 'set-enabled';
      readonly device: string;
      readonly id?: number;
      readonly from?: boolean;
      readonly to: boolean;
    }
  | {
      readonly op: 'set-bypassed';
      readonly device: string;
      readonly id?: number;
      readonly from?: boolean;
      readonly to: boolean;
    }
  | {
      readonly op: 'set-parameter';
      readonly device: string;
      readonly id?: number;
      readonly name: string;
      readonly from?: string;
      readonly to: string;
      readonly comparable: boolean;
    }
  | {
      readonly op: 'connect';
      readonly device: string;
      readonly id?: number;
      readonly port: number;
      readonly from: string;
      readonly source: StepSource;
    };

export type PlanConflict = { readonly entry: string; readonly reason: string };

export type GraphPlan = {
  readonly conflicts: readonly PlanConflict[];
  readonly steps: readonly PlanStep[];
  readonly unchanged: readonly string[];
};

/** An input of a managed device that a remove step's wire takes away; `device` is the entry's name or label. */
export type CutInput = { readonly device: string; readonly id: number; readonly port: number };

/** The listed devices a reference names: `#<id>` by id, a name regardless of case (spec fact 31). */
export function matchDevices(devices: readonly DeviceSummary[], reference: string): DeviceSummary[] {
  const id = idOfReference(reference);
  if (id !== undefined) return devices.filter((device) => device.id === id);
  const wanted = foldCase(reference);
  return devices.filter((device) => foldCase(device.name) === wanted);
}

/**
 * Spec v3 section 5: the existing devices whose details the plan needs, each named by exactly one listed device:
 * managed devices (by id when the entry gives one), `remove` entries, then input sources. Ambiguous names are
 * conflicts and need no read.
 */
export function referencedDeviceIds(spec: GraphSpec, devices: readonly DeviceSummary[]): number[] {
  const ids = new Set<number>();
  const note = (reference: string): void => {
    const matches = matchDevices(devices, reference);
    const only = matches[0];
    if (matches.length === 1 && only !== undefined) ids.add(only.id);
  };
  // Revision 6: an entry with id names its device by id; its name is a label.
  const managedReference = (device: GraphDevice): string =>
    device.id === undefined ? device.name : `#${device.id}`;
  for (const device of spec.devices) note(managedReference(device));
  for (const entry of spec.remove) note(entry);
  // Spec section 4's lookup order: a source naming a managed entry (name or label, regardless of case) is that entry's
  // device, so a listed device that happens to have a label's name is never read for it. A `#<id>` source never equals
  // an entry name: validation refuses names of that form.
  const byEntry = new Map(spec.devices.map((device) => [foldCase(device.name), managedReference(device)]));
  for (const device of spec.devices) {
    for (const input of device.inputs) {
      if (input.source !== null) note(byEntry.get(foldCase(input.source.device)) ?? input.source.device);
    }
  }
  return [...ids];
}

/**
 * Spec v3 section 5 (revision 6), the second read phase: the listed devices not yet read that share their listed name
 * with the current source of an input of a device read so far, when several devices have that name, so
 * `resolveWireSource` holds every candidate's outputs. Empty when every such name is unique.
 */
export function sharedSourceIds(
  devices: readonly DeviceSummary[],
  details: readonly DeviceDetail[],
): number[] {
  const read = new Set(details.map((detail) => detail.id));
  const ids = new Set<number>();
  for (const detail of details) {
    for (const input of detail.inputs) {
      const candidates = sourceCandidates(input, devices);
      if (candidates.length < 2) continue;
      for (const candidate of candidates) if (!read.has(candidate.id)) ids.add(candidate.id);
    }
  }
  return [...ids];
}

/**
 * Unidentifiable-wires design section 3 (revision 2), the third read phase: the listed devices not yet read whose
 * listed name is the predicted source name of a spec input wire the plan does not refuse, when two or more predicted
 * devices have that name, so `unidentifiableWires` holds every candidate's outputs. The predicted devices are the
 * listed ones less those a remove entry names alone, plus the entries the plan adds, named as their entries. The
 * refusals restate planGraph's (unidentifiable-wires plan decision D14): an unusable destination or source entry, an
 * input port the destination lacks, a current wire on it whose source is ambiguous or unknown, a source that names no
 * device, several, or a removed one, and an output port the source lacks. Empty when no such name is shared.
 */
export function predictedSourceIds(
  spec: GraphSpec,
  devices: readonly DeviceSummary[],
  details: readonly DeviceDetail[],
): number[] {
  const read = new Set(details.map((detail) => detail.id));
  const detailOf = (id: number): DeviceDetail | undefined => details.find((detail) => detail.id === id);
  const only = (reference: string): DeviceSummary | undefined => {
    const matches = matchDevices(devices, reference);
    return matches.length === 1 ? matches[0] : undefined;
  };
  const removed = new Set(spec.remove.flatMap((entry) => only(entry)?.id ?? []));

  // planGraph's managed entries: an id no device has, a name several devices share, a Combiner rename, a removed
  // device, another type, or a device an earlier entry claimed makes an entry unusable.
  type Entry = { readonly name: string; readonly existing?: number; readonly usable: boolean };
  const existing = (device: GraphDevice, id: number): Entry => ({
    name: device.name,
    existing: id,
    usable: !removed.has(id) && detailOf(id)?.type === listedType(device.type),
  });
  const entries = new Map<string, Entry>();
  const claimed = new Set<number>();
  for (const device of spec.devices) {
    let entry: Entry;
    const matches =
      device.id === undefined
        ? matchDevices(devices, device.name)
        : devices.filter((listed) => listed.id === device.id);
    const match = matches[0];
    if (matches.length > 1 || (match === undefined && device.id !== undefined)) {
      entry = { name: device.name, usable: false };
    } else if (match === undefined) {
      const defaultName = RENAME_IGNORED.get(device.type);
      entry = { name: device.name, usable: defaultName === undefined || defaultName === device.name };
    } else {
      entry = existing(device, match.id);
      if (claimed.has(match.id)) entry = { ...entry, usable: false };
      claimed.add(match.id);
    }
    entries.set(foldCase(device.name), entry);
  }

  const planned = [...entries.values()].filter((entry) => entry.usable && entry.existing === undefined);
  const holders = (name: string): number =>
    devices.filter((device) => !removed.has(device.id) && device.name === name).length +
    planned.filter((entry) => entry.name === name).length;
  /** The listed name the source will have after the apply; undefined for a source the plan refuses. */
  const sourceName = (source: GraphSource): string | undefined => {
    const own = entries.get(foldCase(source.device));
    let id: number;
    if (own !== undefined) {
      if (!own.usable) return undefined;
      // planGraph checks no port of a device it adds.
      if (own.existing === undefined) return own.name;
      id = own.existing;
    } else {
      const match = only(source.device);
      if (match === undefined || removed.has(match.id)) return undefined;
      id = match.id;
    }
    if (!detailOf(id)?.outputs.some((output) => output.port === source.port)) return undefined;
    return devices.find((device) => device.id === id)?.name;
  };

  /**
   * True when planGraph's currentSource refuses the input: its current wire's source is ambiguous or unknown. A
   * candidate the first two phases did not read leaves it to planGraph (it throws), so the wire reads on.
   */
  const unidentified = (destination: DeviceDetail, input: InputPort): boolean => {
    if (sourceCandidates(input, devices).some((candidate) => detailOf(candidate.id) === undefined))
      return false;
    const current = resolveWireSource(
      listedName(destination.name),
      input,
      devices,
      (id) => detailOf(id)?.outputs,
    );
    return current.kind === 'ambiguous' || current.kind === 'unknown';
  };
  const ids = new Set<number>();
  for (const device of spec.devices) {
    const entry = entries.get(foldCase(device.name));
    if (entry === undefined || !entry.usable) continue;
    const destination = entry.existing === undefined ? undefined : detailOf(entry.existing);
    for (const input of device.inputs) {
      if (input.source === null) continue;
      if (destination !== undefined) {
        const port = destination.inputs.find((candidate) => candidate.port === input.port);
        if (port === undefined || unidentified(destination, port)) continue;
      }
      const name = sourceName(input.source);
      if (name === undefined || holders(name) < 2) continue;
      for (const holder of devices) {
        if (holder.name === name && !read.has(holder.id) && !removed.has(holder.id)) ids.add(holder.id);
      }
    }
  }
  return [...ids];
}

// Spec fact 79 (raw/v3-assumptions.txt l.435-548): `device info` reports the name `device add` gives a new device,
// not the type it takes. Types missing here were captured reporting themselves (Gradient, Advanced Perlin) or are
// assumed to; an unlisted exception shows up as a type conflict, which refuses the apply.
const LISTED_TYPES: Readonly<Record<string, string>> = {
  'Layout Generator': 'Shapes',
  'File Output': 'Height Output',
};

/** The type `device info` reports for a device `device add <type>` made (spec fact 79). */
export function listedType(type: string): string {
  return LISTED_TYPES[type] ?? type;
}

// Spec facts 80-81 (raw/v3-rename-probe.txt, raw/v3-rename-types.txt l.759-943): the only device that ignores a
// rename is the Combiner, which `device add` also makes for these words. A Map, so a type such as 'constructor'
// finds nothing.
const RENAME_IGNORED: ReadonlyMap<string, string> = new Map(
  [
    'Add',
    'Average',
    'Combiner',
    'Differences',
    'Max',
    'Min',
    'Minus',
    'Multiply',
    'Power',
    'Root',
    'Screen',
    'Subtract',
  ].map((type) => [type, 'Combiner']),
);

const TRUE_WORDS = new Set(['true', '1', 'yes', 'on']);
const FALSE_WORDS = new Set(['false', '0', 'no', 'off']);
const INTEGER = /^-?\d+$/;

function boolOf(text: string): boolean | undefined {
  const word = text.trim().toLowerCase();
  return TRUE_WORDS.has(word) ? true : FALSE_WORDS.has(word) ? false : undefined;
}

/** Spec v3 section 5's table: `int` and `bool` are compared; a float (fact 18) and an enum (D1) never are. */
function compare(row: Parameter, text: string): 'same' | 'different' | 'incomparable' {
  if (row.type === 'int') {
    const current = row.value.trim();
    if (!INTEGER.test(current)) return 'incomparable';
    return Number(current) === Number(text) ? 'same' : 'different';
  }
  if (row.type === 'bool') {
    const current = boolOf(row.value);
    const wanted = boolOf(text);
    if (current === undefined || wanted === undefined) return 'incomparable';
    return current === wanted ? 'same' : 'different';
  }
  return 'incomparable';
}

/** The text a value of an added device is sent as; validation already refused numbers in exponent form. */
function valueText(value: ParameterValue): string {
  return typeof value === 'number' ? (decimalText(value) ?? String(value)) : String(value);
}

const ids = (devices: readonly { readonly id: number }[]): string =>
  candidateIds(devices.map((device) => device.id));
const wire = (from: string, to: string, port: number): string => `${from} -> ${to}.${port}`;

type Managed = { readonly spec: GraphDevice; readonly existing?: DeviceDetail; readonly usable: boolean };

/** Spec v3 section 5. Pure: the same spec and state always give the same plan. */
export function planGraph(spec: GraphSpec, state: GraphState): GraphPlan {
  return planWithCuts(spec, state).plan;
}

/**
 * planGraph, and the managed devices' inputs its remove steps cut: apply_graph reads those devices back so the diff
 * shows the cut, also on a device no step names. Only wires the remove steps key by ids count; one keyed by its text
 * marks nothing.
 */
export function planWithCuts(
  spec: GraphSpec,
  state: GraphState,
): { readonly plan: GraphPlan; readonly cutInputs: readonly CutInput[] } {
  const conflicts: PlanConflict[] = [];
  const conflict = (entry: string, reason: string): void => void conflicts.push({ entry, reason });
  const detail = (id: number): DeviceDetail => {
    const found = state.details.find((candidate) => candidate.id === id);
    // The state holds every device referencedDeviceIds names; planning on without one would add a second device of
    // that name, so a caller that skipped a read gets an error, not a plan.
    if (found === undefined) throw new Error(`planGraph: the state holds no details of #${id}`);
    return found;
  };

  const removed = new Map<number, string>();
  const absent: string[] = [];
  for (const entry of spec.remove) {
    const matches = matchDevices(state.devices, entry);
    const only = matches[0];
    if (matches.length > 1) conflict(entry, `remove matches ${ids(matches)}; use #<id>`);
    else if (only === undefined) absent.push(`${entry} (already absent)`);
    else removed.set(only.id, only.name);
  }

  /** The checks an entry that matched an existing device passes: not also removed, and of the spec's type. */
  const existingEntry = (device: GraphDevice, existing: DeviceDetail): Managed => {
    if (removed.has(existing.id)) {
      conflict(device.name, `#${existing.id} is managed and also in remove`);
      return { spec: device, existing, usable: false };
    }
    if (existing.type !== listedType(device.type)) {
      conflict(device.name, `#${existing.id} has type '${existing.type}', not '${listedType(device.type)}'`);
      return { spec: device, existing, usable: false };
    }
    return { spec: device, existing, usable: true };
  };

  const matched: Managed[] = spec.devices.map((device) => {
    // Revision 6: an entry with id manages that device whatever its name, and never adds one.
    if (device.id !== undefined) {
      const listed = state.devices.find((candidate) => candidate.id === device.id);
      if (listed === undefined) {
        conflict(device.name, `#${device.id} matches no listed device; an entry with id never adds a device`);
        return { spec: device, usable: false };
      }
      return existingEntry(device, detail(listed.id));
    }
    const matches = matchDevices(state.devices, device.name);
    const only = matches[0];
    if (matches.length > 1) {
      conflict(device.name, `the name matches ${ids(matches)}; a managed device needs a unique name`);
      return { spec: device, usable: false };
    }
    if (only === undefined) {
      // Revision 6 (facts 80-81): a device of this type keeps its default name, so an add under any other spelling
      // fails and each apply of the spec would try again. Ruling 2: compared exactly, since the apply renames to any
      // other spelling and World Machine ignores that rename too. Ruling 3: an alias type also fails the add's type
      // check, so the reason names the exact type.
      const defaultName = RENAME_IGNORED.get(device.type);
      if (defaultName !== undefined && defaultName !== device.name) {
        const alias =
          device.type === defaultName
            ? ''
            : `, and give the type as '${defaultName}': '${device.type}' is an alias, which fails the type check (fact 81)`;
        conflict(
          device.name,
          `World Machine ignores a rename of a ${defaultName}, so it cannot be added as '${device.name}'; add it with add_device and give its id in the spec${alias}`,
        );
        return { spec: device, usable: false };
      }
      return { spec: device, usable: true };
    }
    return existingEntry(device, detail(only.id));
  });

  // Ruling 1: an entry without id may match the device another entry binds by id; one device gets one entry.
  const claimed = new Map<number, string>();
  const managed: Managed[] = matched.map((entry) => {
    // Codex round 1, ruling 3: an entry that matched a device claims it even when it has a conflict of its own, so a
    // later entry for that device is refused too; only the later entry becomes unusable here.
    if (entry.existing === undefined) return entry;
    const earlier = claimed.get(entry.existing.id);
    if (earlier === undefined) {
      claimed.set(entry.existing.id, entry.spec.name);
      return entry;
    }
    conflict(entry.spec.name, `#${entry.existing.id} is also managed by '${earlier}'`);
    return { ...entry, usable: false };
  });

  const labelOf = (id: number): string | undefined =>
    managed.find((candidate) => candidate.existing?.id === id)?.spec.name;

  /** A spec source resolved to a managed or listed device; undefined after reporting a conflict. */
  const resolveSource = (owner: string, source: GraphSource): StepSource | undefined => {
    // Spec section 4: a managed name or label first. A `#<id>` never equals one: validation refuses names of that form.
    const own = managed.find((candidate) => foldCase(candidate.spec.name) === foldCase(source.device));
    let target: DeviceDetail;
    if (own !== undefined) {
      if (!own.usable) {
        conflict(owner, `input source '${source.device}' is a managed device with a conflict`);
        return undefined;
      }
      if (own.existing === undefined) return { device: own.spec.name, port: source.port };
      target = own.existing;
    } else {
      const matches = matchDevices(state.devices, source.device);
      const only = matches[0];
      if (only === undefined) {
        conflict(owner, `input source '${source.device}' matches no device`);
        return undefined;
      }
      if (matches.length > 1) {
        conflict(owner, `input source '${source.device}' matches ${ids(matches)}; use #<id>`);
        return undefined;
      }
      if (removed.has(only.id)) {
        conflict(owner, `input source '${source.device}' is in remove`);
        return undefined;
      }
      target = detail(only.id);
    }
    if (!target.outputs.some((candidate) => candidate.port === source.port)) {
      conflict(owner, `#${target.id} '${target.name}' has no output port ${source.port}`);
      return undefined;
    }
    // A managed device named by its listed name or `#<id>` shows its spec name or label, as currentSource does.
    return { device: own?.spec.name ?? labelOf(target.id) ?? target.name, id: target.id, port: source.port };
  };

  /** The outputs of a device the state read; undefined for one it did not read. */
  const outputsOf = (id: number): readonly OutputPort[] | undefined =>
    state.details.find((candidate) => candidate.id === id)?.outputs;

  /**
   * The device that feeds `input` of `destination`: undefined without a wire, null after a conflict when
   * resolveWireSource cannot tell (revision 6, fact 82: `wire list` names devices, not ids).
   */
  const currentSource = (
    owner: string,
    destination: DeviceDetail,
    input: InputPort,
  ): (StepSource & { readonly id: number }) | null | undefined => {
    const source = input.source;
    if (source === undefined) return undefined;
    const destinationName = listedName(destination.name);
    const resolved = resolveWireSource(destinationName, input, state.devices, outputsOf);
    if (resolved.kind === 'none') return undefined;
    if (resolved.kind === 'found') {
      const id = resolved.id;
      const listed = state.devices.find((device) => device.id === id);
      return { device: labelOf(id) ?? listed?.name ?? listedName(source.device), id, port: resolved.port };
    }
    const candidates = sourceCandidates(input, state.devices);
    const holders =
      candidates.length === 0
        ? 'a name no listed device has'
        : sharedNameClause(
            candidates.map((candidate) => candidate.id),
            resolved,
            destinationName,
            input.port,
          );
    conflict(
      owner,
      `input ${input.port} is wired from '${listedName(source.device)}', ${holders}; wire list names devices, so the wire's source cannot be identified`,
    );
    return null;
  };

  // Fact 98: World Machine refuses a wire from a device into its own input, with the answer it gives other types.
  const selfWire = (owner: string, port: number): void =>
    conflict(
      owner,
      `input ${port} is wired from the device itself; World Machine refuses a wire from a device into its own input (fact 98)`,
    );

  const disconnects: PlanStep[] = [];
  const adds: PlanStep[] = [];
  const enables: PlanStep[] = [];
  const bypasses: PlanStep[] = [];
  const parameters: PlanStep[] = [];
  const connects: PlanStep[] = [];
  const connect = (device: string, id: number | undefined, port: number, source: StepSource): PlanStep => ({
    op: 'connect',
    device,
    ...(id === undefined ? {} : { id }),
    port,
    from: `${source.device}.${source.port}`,
    source,
  });

  for (const { spec: device, existing, usable } of managed) {
    if (!usable) continue;
    if (existing === undefined) {
      adds.push({ op: 'add', device: device.name, type: device.type });
      // D10: a new device starts enabled.
      if (device.enabled === false) enables.push({ op: 'set-enabled', device: device.name, to: false });
      // Revision 5: a new device starts not bypassed; `device info` reports `Bypass:` (get_device is reliable even
      // for a disabled device, fact 29).
      if (device.bypassed === true) bypasses.push({ op: 'set-bypassed', device: device.name, to: true });
      for (const { name, value } of device.parameters) {
        parameters.push({
          op: 'set-parameter',
          device: device.name,
          name,
          to: valueText(value),
          comparable: false,
        });
      }
      for (const input of device.inputs) {
        if (input.source === null) continue;
        const source = resolveSource(device.name, input.source);
        if (source === undefined) continue;
        // resolveSource names a device the plan adds by its entry, and entry names differ regardless of case.
        if (source.id === undefined && source.device === device.name) selfWire(device.name, input.port);
        else connects.push(connect(device.name, undefined, input.port, source));
      }
      continue;
    }
    const id = existing.id;
    if (device.enabled !== undefined && device.enabled !== existing.enabled) {
      enables.push({
        op: 'set-enabled',
        device: device.name,
        id,
        from: existing.enabled,
        to: device.enabled,
      });
    }
    if (device.bypassed !== undefined && device.bypassed !== existing.bypassed) {
      bypasses.push({
        op: 'set-bypassed',
        device: device.name,
        id,
        from: existing.bypassed,
        to: device.bypassed,
      });
    }
    for (const { name, value } of device.parameters) {
      const row = existing.parameters.find((candidate) => candidate.name === name);
      if (row === undefined) {
        conflict(device.name, `#${id} has no parameter '${name}'`);
        continue;
      }
      // D2: the rule the parameter editor applies, with the listed type.
      const text = parameterText(row, value);
      if ('problem' in text) {
        conflict(device.name, `parameter '${name}' (${row.type}): ${text.problem}`);
        continue;
      }
      const comparison = compare(row, text.text);
      if (comparison === 'same') continue;
      parameters.push({
        op: 'set-parameter',
        device: device.name,
        id,
        name,
        from: row.value,
        to: text.text,
        comparable: comparison === 'different',
      });
    }
    for (const input of device.inputs) {
      const port = existing.inputs.find((candidate) => candidate.port === input.port);
      if (port === undefined) {
        conflict(device.name, `#${id} has no input port ${input.port}`);
        continue;
      }
      const current = currentSource(device.name, existing, port);
      if (current === null) continue;
      const wanted = input.source === null ? null : resolveSource(device.name, input.source);
      if (wanted === undefined) continue;
      if (wanted?.id === id) {
        selfWire(device.name, input.port);
        continue;
      }
      if (
        current !== undefined &&
        wanted !== null &&
        wanted.id === current.id &&
        wanted.port === current.port
      ) {
        continue;
      }
      if (current !== undefined) {
        disconnects.push({
          op: 'disconnect',
          device: device.name,
          id,
          port: input.port,
          from: `${current.device}.${current.port}`,
          source: current,
        });
      }
      if (wanted !== null) connects.push(connect(device.name, id, input.port, wanted));
    }
  }

  // D12, revision 6: a removed device's wires, less those a disconnect step already removes. A wire is keyed by the
  // ids at its ends where resolveWireSource identifies them, so wires to two devices that share a name are both
  // listed; one it cannot identify is keyed by its text, so a target line World Machine repeats
  // (raw/v5-read-formats.txt l.44-45) stays one wire.
  const cut = new Set(
    disconnects.flatMap((step) =>
      step.op === 'disconnect' ? [`${step.source.id}.${step.source.port}>${step.id}.${step.port}`] : [],
    ),
  );
  /** True when every listed device with `input`'s source name was read, so the resolver can run. */
  const readable = (input: InputPort): boolean =>
    sourceCandidates(input, state.devices).every((candidate) => outputsOf(candidate.id) !== undefined);
  /**
   * The device an output target line of removed device `from` names. Branch A: the one listed device of that name.
   * Otherwise the read devices of that name whose input `target.port` resolves to this output qualify. Branch B: the
   * first qualifying device whose input is not yet `taken` by an earlier line of the output. Branch C: every
   * qualifying input is taken and every device of that name was read, so the line repeats one
   * (raw/v5-read-formats.txt l.44-45) and maps to the first. Branch D: none qualifies, or an unread device of that
   * name may be the line's target, so undefined and the caller keys the line by its text. `taken` holds `<id>.<input port>`
   * (Codex round 1, ruling 1), since one device may take wires on several inputs.
   */
  const targetId = (from: number, port: number, target: PortLink, taken: Set<string>): number | undefined => {
    const named = state.devices.filter((device) => device.name === listedName(target.device));
    if (named.length === 1) return named[0]?.id;
    const qualifying = named.flatMap((candidate) => {
      const input = state.details
        .find((read) => read.id === candidate.id)
        ?.inputs.find((own) => own.port === target.port);
      if (input === undefined || !readable(input)) return [];
      const resolved = resolveWireSource(candidate.name, input, state.devices, outputsOf);
      return resolved.kind === 'found' && resolved.id === from && resolved.port === port
        ? [candidate.id]
        : [];
    });
    const free = qualifying.find((candidate) => !taken.has(`${candidate}.${target.port}`));
    if (free !== undefined) {
      taken.add(`${free}.${target.port}`);
      return free;
    }
    // Branch C only when every device of that name was read: an unread sibling may be what the repeated line wires.
    return named.every((candidate) => outputsOf(candidate.id) !== undefined) ? qualifying[0] : undefined;
  };
  /** The ids at the far end of each wire a remove step takes, with the input port when the far end is its target. */
  const severed: { readonly id: number; readonly port?: number }[] = [];
  const removes: PlanStep[] = [...removed].map(([id, name]): PlanStep => {
    const device = detail(id);
    const wires = new Map<string, string>();
    const keep = (key: string, text: string, end?: { readonly id: number; readonly port?: number }): void => {
      if (cut.has(key)) return;
      if (!wires.has(key)) wires.set(key, text);
      if (end !== undefined) severed.push(end);
    };
    for (const input of device.inputs) {
      const source = input.source;
      if (source === undefined) continue;
      const text = wire(`${listedName(source.device)}.${source.port}`, name, input.port);
      // Ruling 6: an unidentified source of a removed device is shown, not a conflict.
      const resolved = readable(input) ? resolveWireSource(name, input, state.devices, outputsOf) : undefined;
      if (resolved?.kind === 'found') {
        keep(`${resolved.id}.${resolved.port}>${id}.${input.port}`, text, { id: resolved.id });
      } else {
        keep(text, text);
      }
    }
    for (const out of device.outputs) {
      const taken = new Set<string>();
      for (const target of out.targets) {
        const text = wire(`${name}.${out.port}`, listedName(target.device), target.port);
        const to = targetId(id, out.port, target, taken);
        if (to === undefined) keep(text, text);
        else keep(`${id}.${out.port}>${to}.${target.port}`, text, { id: to, port: target.port });
      }
    }
    return { op: 'remove', device: name, id, wiresRemoved: [...wires.values()] };
  });

  const steps = [...disconnects, ...removes, ...adds, ...enables, ...bypasses, ...parameters, ...connects];
  // A remove step carries the removed device's listed name, which a label may equal (Review Focus 1).
  const touched = new Set(steps.flatMap((step) => (step.op === 'remove' ? [] : [foldCase(step.device)])));
  // D13. A parameter or input-port conflict leaves its entry usable and adds no step; the entry is still not unchanged,
  // nor is one whose wire a remove step takes.
  const named = new Set(conflicts.map((found) => found.entry));
  const severedIds = new Set(severed.map((end) => end.id));
  const unchanged = [
    ...managed
      .filter(
        (entry) =>
          entry.usable &&
          entry.existing !== undefined &&
          !touched.has(foldCase(entry.spec.name)) &&
          !named.has(entry.spec.name) &&
          !severedIds.has(entry.existing.id),
      )
      .map((entry) => entry.spec.name),
    ...absent,
  ];
  const cutInputs = severed.flatMap((end): CutInput[] => {
    const entry = managed.find((candidate) => candidate.existing?.id === end.id);
    return entry === undefined || end.port === undefined
      ? []
      : [{ device: entry.spec.name, id: end.id, port: end.port }];
  });
  return { plan: { conflicts, steps, unchanged }, cutInputs };
}

/** JSON with object keys sorted at every depth and undefined fields dropped, so equal data gives equal text. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const fields = Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${fields.join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Spec v3 section 5: SHA-256 hex of the project path, the validated spec, and everything the plan read. Deterministic
 * and free of I/O, so it stays in the domain although it uses `node:crypto`.
 */
export function planId(spec: GraphSpec, state: GraphState): string {
  const document = { path: state.projectPath, spec, devices: state.devices, details: state.details };
  return createHash('sha256').update(canonicalJson(document)).digest('hex');
}
