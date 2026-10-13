import type { GraphState, PlanConflict, PlanStep } from '../../domain/graph-plan.js';
import type { GraphSpec } from '../../domain/graph-spec.js';
import {
  type CataloguedPorts,
  typedPorts,
  uncheckedWire,
  wireCompatibility,
  wireConflictReason,
} from '../../domain/port-types.js';
import type { PortTypeCatalogPort } from '../port/out/port-type-catalog-port.js';

/** What the port-type check adds to a plan (port-types design section 6). */
export type WireTypeCheck = {
  readonly conflicts: readonly PlanConflict[];
  readonly uncheckedWires: readonly string[];
};

/**
 * Port-types design sections 5 and 6, shared by plan_graph and apply_graph (port-types plan decisions D5-D8): every
 * `connect` step is checked. An existing end is typed when its type is catalogued and its ports, as the graph read
 * showed them, pass the domain's fingerprint; a device the plan adds is typed by its type alone, when that word is
 * one the capture added (Codex round 1 ruling B1). A wire the input does not accept is a conflict on its
 * destination's entry; a wire with an untyped end is listed by its destination's entry and port. A wire the spec
 * keeps is no step and is not checked.
 */
export function checkWireTypes(
  spec: GraphSpec,
  state: GraphState,
  steps: readonly PlanStep[],
  portTypes: PortTypeCatalogPort,
): WireTypeCheck {
  const portsOf = (id: number | undefined, name: string): CataloguedPorts | undefined => {
    if (id === undefined) {
      const planned = spec.devices.find((device) => device.id === undefined && device.name === name);
      // Codex round 1 ruling B1: only a spelling the capture added exactly types a planned device.
      return planned === undefined ? undefined : portTypes.portsOfAdded(planned.type);
    }
    const detail = state.details.find((candidate) => candidate.id === id);
    return detail === undefined ? undefined : typedPorts(detail, portTypes.portsOf(detail.type));
  };
  const conflicts: PlanConflict[] = [];
  const uncheckedWires: string[] = [];
  for (const step of steps) {
    if (step.op !== 'connect') continue;
    const output = portsOf(step.source.id, step.source.device)?.outputs.find(
      (port) => port.port === step.source.port,
    );
    const input = portsOf(step.id, step.device)?.inputs.find((port) => port.port === step.port);
    const answer = wireCompatibility(output, input);
    if (answer === 'unchecked') {
      uncheckedWires.push(uncheckedWire(step.device, step.port));
    } else if (answer === 'incompatible' && output !== undefined && input !== undefined) {
      conflicts.push({
        entry: step.device,
        reason: wireConflictReason(step.source.device, output, step.device, input),
      });
    }
  }
  return { conflicts, uncheckedWires };
}
