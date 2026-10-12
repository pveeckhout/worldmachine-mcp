import type { DeviceSummary, InputPort, OutputPort } from './device.js';
import { listedName, matchesListedName } from './device-name.js';

/** Spec v3 section 5 (revision 6): what feeds one input, as far as `wire list` output can tell. */
export type WireSource =
  | { readonly kind: 'none' }
  | { readonly kind: 'found'; readonly id: number; readonly port: number }
  | { readonly kind: 'unknown' }
  | { readonly kind: 'ambiguous'; readonly candidates: readonly number[] };

/** The listed devices whose name is the one `input` shows as its source, compared as listed (fact 33). */
export function sourceCandidates(input: InputPort, devices: readonly DeviceSummary[]): DeviceSummary[] {
  const source = input.source;
  if (source === undefined) return [];
  const shown = listedName(source.device);
  return devices.filter((device) => device.name === shown);
}

/**
 * Spec v3 section 5 (revision 6, fact 82): `wire list` names the devices at both ends of a wire, never their ids. One
 * candidate is the source. With several, the source is the one whose output port (the input's source port) lists a
 * target with the destination's listed name and the input's port. Pure; the planner and the wire editor share it.
 * `outputsOf` gives the output ports of a device read so far; a candidate without them is a caller's error.
 */
export function resolveWireSource(
  destinationName: string,
  input: InputPort,
  devices: readonly DeviceSummary[],
  outputsOf: (id: number) => readonly OutputPort[] | undefined,
): WireSource {
  const source = input.source;
  if (source === undefined) return { kind: 'none' };
  const candidates = sourceCandidates(input, devices);
  const only = candidates[0];
  if (candidates.length === 1 && only !== undefined) return { kind: 'found', id: only.id, port: source.port };
  const qualifying = candidates.filter((candidate) => {
    const outputs = outputsOf(candidate.id);
    // The read phases (section 5) read every candidate; resolving without one would guess.
    if (outputs === undefined)
      throw new Error(`resolveWireSource: the outputs of #${candidate.id} were not read`);
    return outputs.some(
      (output) =>
        output.port === source.port &&
        output.targets.some(
          (target) => matchesListedName(target.device, destinationName) && target.port === input.port,
        ),
    );
  });
  const first = qualifying[0];
  if (qualifying.length === 1 && first !== undefined)
    return { kind: 'found', id: first.id, port: source.port };
  if (qualifying.length > 1)
    return { kind: 'ambiguous', candidates: qualifying.map((candidate) => candidate.id) };
  return { kind: 'unknown' };
}
