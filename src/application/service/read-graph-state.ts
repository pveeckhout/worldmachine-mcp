import type { DeviceDetail } from '../../domain/device.js';
import { type GraphState, referencedDeviceIds, sharedSourceIds } from '../../domain/graph-plan.js';
import type { GraphSpec } from '../../domain/graph-spec.js';
import type { ProjectGraphReadPort } from '../port/out/project-graph-read-port.js';
import type { WorldMachineSessionPort } from '../port/out/world-machine-session-port.js';

/**
 * Spec v3 section 5: `device list` once, then `get_device` of each device the spec references, by `#<id>`, then
 * (revision 6) of each unread device that shares its listed name with the current source of an input read in the
 * first phase, so planGraph can resolve that source. The binding is read last, after the reads have started World
 * Machine if it was not running.
 */
export async function readGraphState(
  spec: GraphSpec,
  graph: ProjectGraphReadPort,
  session: WorldMachineSessionPort,
): Promise<GraphState> {
  const devices = await graph.listDevices();
  const details: DeviceDetail[] = [];
  for (const id of referencedDeviceIds(spec, devices)) details.push(await graph.getDevice(`#${id}`));
  // The second phase's ids are computed once, from the first phase's details.
  for (const id of sharedSourceIds(devices, details)) details.push(await graph.getDevice(`#${id}`));
  const binding = session.status().session.binding;
  return { projectPath: binding?.kind === 'opened' ? binding.path : null, devices, details };
}
