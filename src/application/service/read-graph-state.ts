import type { DeviceDetail } from '../../domain/device.js';
import {
  downstreamIds,
  type GraphState,
  predictedSourceIds,
  referencedDeviceIds,
  sharedSourceIds,
} from '../../domain/graph-plan.js';
import type { GraphSpec } from '../../domain/graph-spec.js';
import type { SessionSummary } from '../../domain/session.js';
import type { ProjectGraphReadPort } from '../port/out/project-graph-read-port.js';
import type { WorldMachineSessionPort } from '../port/out/world-machine-session-port.js';

/**
 * Spec v3 section 5: `device list` once, then `get_device` of each device the spec references, by `#<id>`, then
 * (revision 6) of each unread device that shares its listed name with the current source of an input read in the
 * first phase, so planGraph can resolve that source, then (unidentifiable-wires design section 3) of each unread
 * device that has the predicted source name of a spec input wire when another predicted device has that name too,
 * so unidentifiableWires can resolve the wire after the apply, then (wire-loops design section 3) in rounds of each
 * unread device downstream of the destinations of the spec's input wires, so wireLoops can follow every path from
 * them. Revision 8: `scene show` runs first, once, only when the spec has `scene`. The binding is read last, after the reads have started World Machine if it was not running.
 */
export async function readGraphState(
  spec: GraphSpec,
  graph: ProjectGraphReadPort,
  session: WorldMachineSessionPort,
): Promise<GraphState & { readonly session: SessionSummary }> {
  // Revision 8: `scene show` once, first, only when the spec has `scene`.
  const scene = spec.scene === undefined ? undefined : await graph.getScene();
  const devices = await graph.listDevices();
  const details: DeviceDetail[] = [];
  for (const id of referencedDeviceIds(spec, devices)) details.push(await graph.getDevice(`#${id}`));
  // The second phase's ids are computed once, from the first phase's details.
  for (const id of sharedSourceIds(devices, details)) details.push(await graph.getDevice(`#${id}`));
  // Unidentifiable-wires design section 3: computed once, from the first two phases' details.
  for (const id of predictedSourceIds(spec, devices, details)) details.push(await graph.getDevice(`#${id}`));
  // Wire-loops design section 3: a round per call, until one finds no unread device; each device is read once.
  for (
    let ids = downstreamIds(spec, devices, details);
    ids.length > 0;
    ids = downstreamIds(spec, devices, details)
  ) {
    for (const id of ids) details.push(await graph.getDevice(`#${id}`));
  }
  // The one status read of a plan: the caller reports this summary instead of reading the status again.
  const summary = session.status().session;
  const binding = summary.binding;
  return {
    projectPath: binding?.kind === 'opened' ? binding.path : null,
    devices,
    details,
    ...(scene === undefined ? {} : { scene }),
    session: summary,
  };
}
