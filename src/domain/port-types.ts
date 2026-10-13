// Port-types design sections 4-7: port types from a catalog captured once per World Machine build, since the console
// reports none (design section 2). Pure: the version fingerprint, a wire's compatibility, and the texts.

/** An output class (design section 4): output ports that the same inputs accept, by catalog id and name. */
export type PortClass = { readonly id: string; readonly name: string };

/** A catalogued output port and its class. */
export type CataloguedOutput = { readonly port: number; readonly name: string; readonly type: PortClass };

/** A catalogued input port and the output classes it accepts. */
export type CataloguedInput = {
  readonly port: number;
  readonly name: string;
  readonly accepts: readonly PortClass[];
};

/** A type's ports as `device add` creates them, inputs and outputs in port order. */
export type CataloguedPorts = {
  readonly inputs: readonly CataloguedInput[];
  readonly outputs: readonly CataloguedOutput[];
};

type PortName = { readonly port: number; readonly name: string };

/** A device's ports as `wire list` shows them; a DeviceDetail has this shape. */
export type PortNames = { readonly inputs: readonly PortName[]; readonly outputs: readonly PortName[] };

export type WireCompatibility = 'compatible' | 'incompatible' | 'unchecked';

const samePorts = (listed: readonly PortName[], catalogued: readonly PortName[]): boolean =>
  listed.length === catalogued.length &&
  listed.every(
    (port, index) => port.port === catalogued[index]?.port && port.name === catalogued[index]?.name,
  );

/**
 * Design section 5, the version fingerprint: the device's port names, inputs and outputs in order, equal the
 * catalogued ports of its type. A console-added device can be an older version with other ports (design section 2).
 */
export function fingerprintMatches(ports: PortNames, catalogued: CataloguedPorts): boolean {
  return samePorts(ports.inputs, catalogued.inputs) && samePorts(ports.outputs, catalogued.outputs);
}

/**
 * The catalogued ports of a device the project holds, when it passes the fingerprint; undefined for an untyped
 * device. Every typing of such a device goes through here (port-types plan decision D5).
 */
export function typedPorts(
  ports: PortNames,
  catalogued: CataloguedPorts | undefined,
): CataloguedPorts | undefined {
  return catalogued !== undefined && fingerprintMatches(ports, catalogued) ? catalogued : undefined;
}

/** Design section 7: unchecked when an end is untyped, or its type has no port of that number (plan decision D7). */
export function wireCompatibility(
  output: CataloguedOutput | undefined,
  input: CataloguedInput | undefined,
): WireCompatibility {
  if (output === undefined || input === undefined) return 'unchecked';
  return input.accepts.some((accepted) => accepted.id === output.type.id) ? 'compatible' : 'incompatible';
}

/** Design section 4, plan decision D15: the names of the classes an input accepts, or `nothing`. */
export function acceptsText(input: CataloguedInput): string {
  return input.accepts.length === 0 ? 'nothing' : input.accepts.map((accepted) => accepted.name).join(', ');
}

/** Design section 6: the reason of a plan_graph conflict for a wire the input does not accept. */
export function wireConflictReason(
  source: string,
  output: CataloguedOutput,
  destination: string,
  input: CataloguedInput,
): string {
  return `'${source}' output ${output.port} (${output.type.name}) cannot feed '${destination}' input ${input.port}, which accepts ${acceptsText(input)}`;
}

/** Design section 6: what a connect_devices refusal for `incompatible types?` gains when both ends are typed. */
export function refusalTypes(output: CataloguedOutput, input: CataloguedInput): string {
  return `: output ${output.port} is ${output.type.name}; input ${input.port} accepts ${acceptsText(input)}`;
}

/** Design section 6, plan decision D15: an `uncheckedWires` entry, by the destination's spec entry and port. */
export function uncheckedWire(destination: string, port: number): string {
  return `'${destination}' input ${port}`;
}
