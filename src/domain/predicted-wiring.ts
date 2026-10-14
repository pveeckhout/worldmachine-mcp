import type { DeviceSummary, InputPort, OutputPort, PortLink } from './device.js';
import { foldCase, matchesListedName } from './device-name.js';
import { type GraphState, matchDevices, type PlanStep } from './graph-plan.js';
import type { GraphSpec } from './graph-spec.js';
import { resolveWireSource, sourceCandidates, type WireSource } from './wire-source.js';

/** An output port of the predicted state; its target lines change as the steps apply. */
type PredictedOutput = { readonly port: number; readonly name: string; readonly targets: PortLink[] };

/** An input of a managed device after the apply; `kept` while it is the wire the device has now. */
export type PredictedInput = { readonly source: PortLink | undefined; readonly kept: boolean };

/**
 * A managed device: its spec entry, its id (below zero for a planned one), its listed name after the apply, and the
 * input ports its entry lists.
 */
export type Destination = {
  readonly entry: string;
  readonly id: number;
  readonly name: string;
  readonly listedPorts: ReadonlySet<number>;
};

/**
 * Unidentifiable-wires design section 2: the wiring after the apply, as far as `wire list` text can predict it.
 * `devices` are the listed devices less the removed ones, plus one per add step with a placeholder id below zero
 * (`plannedNames` names them); `outputsOf` gives the target lines of a read or planned device; `inputsOf` gives the
 * inputs of a managed device (`destinations`, in spec entry order); `idOf` gives a step's device id.
 */
export type PredictedWiring = {
  readonly devices: readonly DeviceSummary[];
  readonly plannedNames: ReadonlyMap<number, string>;
  readonly destinations: readonly Destination[];
  readonly outputsOf: (id: number) => readonly OutputPort[] | undefined;
  readonly inputsOf: (id: number) => ReadonlyMap<number, PredictedInput> | undefined;
  readonly idOf: (device: string, id: number | undefined) => number | undefined;
};

/**
 * Wire-loops design section 2: the model `unidentifiableWires` builds (unidentifiable-wires design section 2 and
 * revision 2), shared with `wireLoops`. Pure. Where `wire list` text cannot say which target line a step takes away,
 * the line stays (unidentifiable-wires plan decisions D6 and D7).
 */
export function predictWiring(
  spec: GraphSpec,
  state: GraphState,
  steps: readonly PlanStep[],
): PredictedWiring {
  const detailOf = (id: number) => state.details.find((detail) => detail.id === id);
  const currentOutputsOf = (id: number): readonly OutputPort[] | undefined => detailOf(id)?.outputs;

  // Devices: the listed ones less the removed ones, plus one per add step, with a placeholder id below zero
  // (unidentifiable-wires plan decision D5).
  const removed = new Set(steps.flatMap((step) => (step.op === 'remove' ? [step.id] : [])));
  const plannedIds = new Map<string, number>();
  const plannedNames = new Map<number, string>();
  for (const step of steps) {
    if (step.op !== 'add') continue;
    const id = -(plannedNames.size + 1);
    plannedIds.set(foldCase(step.device), id);
    plannedNames.set(id, step.device);
  }
  const devices: DeviceSummary[] = [
    ...state.devices.filter((device) => !removed.has(device.id)),
    ...[...plannedNames].map(([id, name]) => ({ id, name, enabled: true })),
  ];
  /** The listed name after the apply: a planned device is named exactly as its entry (v3 revision 6). */
  const nameOf = (id: number): string | undefined =>
    plannedNames.get(id) ?? state.devices.find((device) => device.id === id)?.name;
  /** A step's device: its id when it exists, otherwise the placeholder of the add step that plans it. */
  const idOf = (device: string, id: number | undefined): number | undefined =>
    id ?? plannedIds.get(foldCase(device));

  // Output targets: the read devices' current lines; a planned device starts with none.
  const outputs = new Map<number, PredictedOutput[]>();
  for (const detail of state.details) {
    if (removed.has(detail.id)) continue;
    outputs.set(
      detail.id,
      detail.outputs.map((output) => ({
        port: output.port,
        name: output.name,
        targets: [...output.targets],
      })),
    );
  }
  for (const id of plannedNames.keys()) outputs.set(id, []);
  const targetsOf = (id: number, port: number): PortLink[] | undefined => {
    const ports = outputs.get(id);
    if (ports === undefined) return undefined;
    const found = ports.find((output) => output.port === port);
    if (found !== undefined) return found.targets;
    const added: PredictedOutput = { port, name: '', targets: [] };
    ports.push(added);
    return added.targets;
  };
  /** Takes one matching target line off an output, never every one (unidentifiable-wires plan decision D7). */
  const cut = (id: number, port: number, destination: string, input: number): void => {
    const targets = targetsOf(id, port);
    if (targets === undefined) return;
    const index = targets.findIndex(
      (target) => matchesListedName(target.device, destination) && target.port === input,
    );
    if (index >= 0) targets.splice(index, 1);
  };

  // Inputs of the managed devices, in spec entry order; one device gets one entry, as in planGraph.
  const destinations: Destination[] = [];
  const inputs = new Map<number, Map<number, PredictedInput>>();
  for (const device of spec.devices) {
    const matches =
      device.id === undefined
        ? matchDevices(state.devices, device.name)
        : state.devices.filter((listed) => listed.id === device.id);
    const existing = matches.length === 1 ? matches[0]?.id : undefined;
    // An entry without id that matches no listed device is the device its add step plans (planGraph's rule).
    const planned =
      matches.length === 0 && device.id === undefined ? plannedIds.get(foldCase(device.name)) : undefined;
    const id = existing ?? planned;
    if (id === undefined || removed.has(id) || inputs.has(id)) continue;
    const name = nameOf(id);
    if (name === undefined) continue;
    const ports = new Map<number, PredictedInput>();
    for (const input of detailOf(id)?.inputs ?? [])
      ports.set(input.port, { source: input.source, kept: true });
    destinations.push({
      entry: device.name,
      id,
      name,
      listedPorts: new Set(device.inputs.map((input) => input.port)),
    });
    inputs.set(id, ports);
  }
  const set = (id: number, port: number, source: PortLink | undefined): void => {
    inputs.get(id)?.set(port, { source, kept: false });
  };

  /** How the current state reads an input, as planGraph's currentSource does. */
  const current = (destination: string, input: InputPort): WireSource =>
    resolveWireSource(destination, input, state.devices, currentOutputsOf);
  /** True when every listed device with `input`'s source name was read, so `current` can run. */
  const readable = (input: InputPort): boolean =>
    sourceCandidates(input, state.devices).every((candidate) => currentOutputsOf(candidate.id) !== undefined);

  for (const step of steps) {
    switch (step.op) {
      case 'disconnect': {
        const destination = nameOf(step.id);
        if (destination !== undefined) cut(step.source.id, step.source.port, destination, step.port);
        set(step.id, step.port, undefined);
        break;
      }
      case 'remove': {
        // Unidentifiable-wires plan decision D6: a source loses its line to the removed device where the current
        // state identifies it, and a managed input the removed device feeds loses its source.
        const name = nameOf(step.id) ?? step.device;
        for (const input of detailOf(step.id)?.inputs ?? []) {
          if (input.source === undefined || !readable(input)) continue;
          const resolved = current(name, input);
          if (resolved.kind === 'found') cut(resolved.id, resolved.port, name, input.port);
        }
        for (const destination of destinations) {
          for (const [port, predicted] of inputs.get(destination.id) ?? []) {
            const source = predicted.source;
            if (!predicted.kept || source === undefined) continue;
            const input: InputPort = { port, name: '', source };
            if (!readable(input)) continue;
            const resolved = current(destination.name, input);
            if (resolved.kind === 'found' && resolved.id === step.id) set(destination.id, port, undefined);
          }
        }
        break;
      }
      case 'connect': {
        const destination = idOf(step.device, step.id);
        const source = idOf(step.source.device, step.source.id);
        if (destination === undefined || source === undefined) break;
        const destinationName = nameOf(destination);
        const sourceName = nameOf(source);
        if (destinationName === undefined || sourceName === undefined) break;
        targetsOf(source, step.source.port)?.push({ device: destinationName, port: step.port });
        set(destination, step.port, { device: sourceName, port: step.source.port });
        break;
      }
      default:
        break;
    }
  }

  return {
    devices,
    plannedNames,
    destinations,
    outputsOf: (id) => outputs.get(id),
    inputsOf: (id) => inputs.get(id),
    idOf,
  };
}
