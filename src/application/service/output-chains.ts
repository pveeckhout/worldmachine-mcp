import { type ChainDevice, devicesNamed } from '../../domain/build-result.js';
import type { DeviceDetail } from '../../domain/device.js';
import { listedName } from '../../domain/device-name.js';
import { WorldMachineError } from '../../domain/errors.js';
import { resolveWireSource, sharedNameClause, sourceCandidates } from '../../domain/wire-source.js';
import type { ExportPort } from '../port/out/export-port.js';
import type { ProjectGraphReadPort } from '../port/out/project-graph-read-port.js';

/** Build-not-built design section 4: the configured outputs, by id, and every device on their input chains. */
export type OutputChains = {
  readonly outputs: readonly number[];
  /** In read order: the outputs first, then each device upstream, breadth first. */
  readonly graph: readonly ChainDevice[];
};

/**
 * Section 4 steps 1-3 (plan decision B2): `export list` gives the outputs by name (fact 49), matched to `device list`
 * by `devicesNamed` (B3); then `get_device` of each output and of every device upstream of it, as `plan_graph` reads
 * devices, with each wire's source resolved by `resolveWireSource` (fact 82, B4). Each device is read once.
 */
export async function readOutputChains(
  exports: ExportPort,
  graph: ProjectGraphReadPort,
): Promise<OutputChains> {
  const targets = await exports.targets();
  if (targets.length === 0) return { outputs: [], graph: [] };
  // Plan decision B3a (Codex round 3, ruling 1): an ambiguous row's device name is a guess (output-template.ts l.4-9),
  // so it is refused before any name is matched; an output that was not read never counts as built (section 4).
  const ambiguous = targets.find((target) => target.ambiguous);
  if (ambiguous !== undefined) {
    throw new WorldMachineError(
      'UNEXPECTED_OUTPUT',
      `export list row for '${ambiguous.device}' holds more than one ' -> ', so the output it names cannot be read reliably`,
    );
  }
  const devices = await graph.listDevices();
  const outputs: number[] = [];
  for (const target of targets) {
    const named = devicesNamed(target.device, devices);
    if (named.length === 0) {
      throw new WorldMachineError(
        'UNEXPECTED_OUTPUT',
        `export list names '${target.device}', which no device in device list has`,
      );
    }
    for (const device of named) if (!outputs.includes(device.id)) outputs.push(device.id);
  }
  const details = new Map<number, DeviceDetail>();
  const read = async (id: number): Promise<DeviceDetail> => {
    const known = details.get(id);
    if (known !== undefined) return known;
    const detail = await graph.getDevice(`#${id}`);
    details.set(id, detail);
    return detail;
  };
  const chain = new Map<number, ChainDevice>();
  const queue = [...outputs];
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    if (chain.has(id)) continue;
    const detail = await read(id);
    const destination = listedName(detail.name);
    const sources: number[] = [];
    for (const input of detail.inputs) {
      const source = input.source;
      if (source === undefined) continue;
      const candidates = sourceCandidates(input, devices);
      // Fact 82: with several candidates, resolveWireSource needs the outputs of each.
      if (candidates.length > 1) for (const candidate of candidates) await read(candidate.id);
      const resolved = resolveWireSource(
        destination,
        input,
        devices,
        (candidate) => details.get(candidate)?.outputs,
      );
      if (resolved.kind === 'found') {
        sources.push(resolved.id);
        queue.push(resolved.id);
        continue;
      }
      if (resolved.kind === 'none') continue;
      // The planner's wording (graph-plan.ts l.354-360).
      const holders =
        candidates.length === 0
          ? 'a name no listed device has'
          : sharedNameClause(
              candidates.map((candidate) => candidate.id),
              resolved,
              destination,
              input.port,
            );
      throw new WorldMachineError(
        'UNEXPECTED_OUTPUT',
        `The source of '${detail.name}' input ${input.port} cannot be identified: '${listedName(source.device)}' is ${holders}`,
      );
    }
    const { name, type, enabled, bypassed } = detail;
    chain.set(id, { id, name, type, enabled, bypassed, sources });
  }
  return { outputs, graph: [...chain.values()] };
}
