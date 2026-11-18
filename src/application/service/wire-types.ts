import type { GraphState, PlanConflict, PlanStep } from '../../domain/graph-plan.js';
import type { GraphSpec } from '../../domain/graph-spec.js';
import {
  type CataloguedPorts,
  correctedCompatibility,
  typedPorts,
  uncheckedWire,
  wireCompatibility,
  wireConflictReason,
  wireRefusedReason,
} from '../../domain/port-types.js';
import type { PortTypeCatalogPort } from '../port/out/port-type-catalog-port.js';

/** What the port-type check adds to a plan (port-types design section 6). */
export type WireTypeCheck = {
  readonly conflicts: readonly PlanConflict[];
  /** The type findings of a sample-derived catalog: listed, never blocking (user-built catalogs decision D5). */
  readonly warnings: readonly PlanConflict[];
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
  type Typed = { readonly type: string; readonly ports: CataloguedPorts };
  const typedOf = (id: number | undefined, name: string): Typed | undefined => {
    if (id === undefined) {
      const planned = spec.devices.find((device) => device.id === undefined && device.name === name);
      // Codex round 1 ruling B1: only a spelling the capture added exactly types a planned device.
      const ports = planned === undefined ? undefined : portTypes.portsOfAdded(planned.type);
      const type = planned === undefined ? undefined : portTypes.typeOfAdded(planned.type);
      return ports === undefined || type === undefined ? undefined : { type, ports };
    }
    const detail = state.details.find((candidate) => candidate.id === id);
    const ports = detail === undefined ? undefined : typedPorts(detail, portTypes.portsOf(detail.type));
    return detail === undefined || ports === undefined ? undefined : { type: detail.type, ports };
  };
  const findings: PlanConflict[] = [];
  const uncheckedWires: string[] = [];
  for (const step of steps) {
    if (step.op !== 'connect') continue;
    const from = typedOf(step.source.id, step.source.device);
    const to = typedOf(step.id, step.device);
    const output = from?.ports.outputs.find((port) => port.port === step.source.port);
    const input = to?.ports.inputs.find((port) => port.port === step.port);
    const correction =
      from === undefined || to === undefined || output === undefined || input === undefined
        ? undefined
        : portTypes.correctionOf({ type: from.type, port: output.name }, { type: to.type, port: input.name });
    const catalogAnswer = wireCompatibility(output, input);
    const answer = correctedCompatibility(catalogAnswer, correction);
    if (answer === 'unchecked') {
      uncheckedWires.push(uncheckedWire(step.device, step.port));
    } else if (answer === 'incompatible' && output !== undefined && input !== undefined) {
      const build = portTypes.catalogInUse()?.build;
      findings.push({
        entry: step.device,
        reason:
          catalogAnswer === 'compatible' && build !== undefined
            ? wireRefusedReason(step.source.device, output, step.device, input, build)
            : wireConflictReason(step.source.device, output, step.device, input),
      });
    }
  }
  return portTypes.catalogInUse()?.kind === 'sample-derived'
    ? { conflicts: [], warnings: findings, uncheckedWires }
    : { conflicts: findings, warnings: [], uncheckedWires };
}
