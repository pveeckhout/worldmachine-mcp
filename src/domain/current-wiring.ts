import type { DeviceDetail, DeviceSummary, InputPort, OutputPort } from './device.js';
import { resolveWireSource, sourceCandidates, type WireSource } from './wire-source.js';

/**
 * How the state a plan read shows its wires: `wire list` names devices, not ids (fact 82), so a source is found
 * through `resolveWireSource` and only where every device of its name was read. Pure.
 */
export function currentWiring(read: {
  readonly devices: readonly DeviceSummary[];
  readonly details: readonly DeviceDetail[];
}): {
  readonly outputsOf: (id: number) => readonly OutputPort[] | undefined;
  readonly current: (destination: string, input: InputPort) => WireSource;
  readonly readable: (input: InputPort) => boolean;
} {
  /** The outputs of a device the state read; undefined for one it did not read. */
  const outputsOf = (id: number): readonly OutputPort[] | undefined =>
    read.details.find((detail) => detail.id === id)?.outputs;
  return {
    outputsOf,
    /** How the current state reads an input, as planGraph's currentSource does (fact 82). */
    current: (destination, input) => resolveWireSource(destination, input, read.devices, outputsOf),
    /** True when every listed device with `input`'s source name was read, so `current` can run (fact 82). */
    readable: (input) =>
      sourceCandidates(input, read.devices).every((candidate) => outputsOf(candidate.id) !== undefined),
  };
}
