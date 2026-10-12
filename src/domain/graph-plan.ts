import { createHash } from 'node:crypto';
import type { DeviceDetail, DeviceSummary, InputPort, Parameter } from './device.js';
import { foldCase, idOfReference, listedName } from './device-name.js';
import type { ParameterValue } from './graph-edit.js';
import type { GraphDevice, GraphSource, GraphSpec } from './graph-spec.js';
import { decimalText, parameterText } from './parameter-values.js';
import { sourceCandidates } from './wire-source.js';

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
  devices.map((device) => `#${device.id}`).join(', ');
const wire = (from: string, to: string, port: number): string => `${from} -> ${to}.${port}`;

type Managed = { readonly spec: GraphDevice; readonly existing?: DeviceDetail; readonly usable: boolean };

/** Spec v3 section 5. Pure: the same spec and state always give the same plan. */
export function planGraph(spec: GraphSpec, state: GraphState): GraphPlan {
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

  /**
   * The device `wire list` shows as the source of `input`: undefined without a wire, null after a conflict when no
   * single listed device has the printed name (D4, ruling K4': `wire list` names devices, not ids).
   */
  const currentSource = (
    owner: string,
    input: InputPort,
  ): (StepSource & { readonly id: number }) | null | undefined => {
    const source = input.source;
    if (source === undefined) return undefined;
    const shown = listedName(source.device);
    const matches = state.devices.filter((device) => device.name === shown);
    const only = matches[0];
    if (only === undefined || matches.length > 1) {
      const holders = only === undefined ? 'no listed device has' : `${ids(matches)} share`;
      conflict(
        owner,
        `input ${input.port} is wired from '${shown}', a name ${holders}; wire list names devices, so the wire's source cannot be identified`,
      );
      return null;
    }
    const own = managed.find((candidate) => candidate.existing?.id === only.id);
    return { device: own?.spec.name ?? only.name, id: only.id, port: source.port };
  };

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
        if (source !== undefined) connects.push(connect(device.name, undefined, input.port, source));
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
      const current = currentSource(device.name, port);
      if (current === null) continue;
      const wanted = input.source === null ? null : resolveSource(device.name, input.source);
      if (wanted === undefined) continue;
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

  // D12: a removed device's wires, less those a disconnect step already removes. Wire ends are keyed by id where the
  // printed name identifies one listed device.
  const idOfShown = (printed: string): number | undefined => {
    const matches = state.devices.filter((device) => device.name === listedName(printed));
    return matches.length === 1 ? matches[0]?.id : undefined;
  };
  const cut = new Set(
    disconnects.flatMap((step) =>
      step.op === 'disconnect' ? [`${step.source.id}.${step.source.port}>${step.id}.${step.port}`] : [],
    ),
  );
  const removes: PlanStep[] = [...removed].map(([id, name]): PlanStep => {
    const device = detail(id);
    const wires = [
      ...device.inputs.flatMap((input) =>
        input.source === undefined
          ? []
          : [
              {
                key: `${idOfShown(input.source.device)}.${input.source.port}>${id}.${input.port}`,
                text: wire(`${listedName(input.source.device)}.${input.source.port}`, name, input.port),
              },
            ],
      ),
      ...device.outputs.flatMap((out) =>
        out.targets.map((target) => ({
          key: `${id}.${out.port}>${idOfShown(target.device)}.${target.port}`,
          text: wire(`${name}.${out.port}`, listedName(target.device), target.port),
        })),
      ),
    ];
    const wiresRemoved = [...new Set(wires.filter((w) => !cut.has(w.key)).map((w) => w.text))];
    return { op: 'remove', device: name, id, wiresRemoved };
  });

  const steps = [...disconnects, ...removes, ...adds, ...enables, ...bypasses, ...parameters, ...connects];
  // A remove step carries the removed device's listed name, which a label may equal (Review Focus 1).
  const touched = new Set(steps.flatMap((step) => (step.op === 'remove' ? [] : [foldCase(step.device)])));
  // D13.
  const unchanged = [
    ...managed
      .filter(
        (entry) => entry.usable && entry.existing !== undefined && !touched.has(foldCase(entry.spec.name)),
      )
      .map((entry) => entry.spec.name),
    ...absent,
  ];
  return { conflicts, steps, unchanged };
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
