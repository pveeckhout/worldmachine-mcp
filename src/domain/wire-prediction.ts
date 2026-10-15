import { currentWiring } from './current-wiring.js';
import type { InputPort } from './device.js';
import { listedName } from './device-name.js';
import type { GraphState, PlanStep } from './graph-plan.js';
import type { GraphSpec } from './graph-spec.js';
import { predictWiring } from './predicted-wiring.js';
import { resolveWireSource } from './wire-source.js';

/**
 * Unidentifiable-wires design section 2: the wires into managed devices that `resolveWireSource` would report as
 * ambiguous once `steps` are applied, so that a later plan could not identify them. Pure. Each entry reads
 * `'<entry>' input <q> from '<source name>' output <p>: <candidates> each list '<destination>' input <q>`, in spec
 * entry order, then input port (unidentifiable-wires plan decision D3). A kept wire on an input the spec entry lists
 * that the current state cannot identify is the plan's conflict already and is not listed (plan decision D2); a kept
 * wire on an input the entry does not list is no conflict and is listed whenever the predicted state finds it
 * ambiguous. Like planGraph, it throws for a candidate whose outputs the state did not read: readGraphState's
 * phases read every one. The predicted state is `predictWiring`'s (wire-loops design section 2).
 */
export function unidentifiableWires(
  spec: GraphSpec,
  state: GraphState,
  steps: readonly PlanStep[],
): string[] {
  const wiring = predictWiring(spec, state, steps);
  const { current } = currentWiring(state);
  const candidate = (id: number): string => {
    const planned = wiring.plannedNames.get(id);
    return planned === undefined ? `#${id}` : `the planned '${planned}'`;
  };
  const listed: string[] = [];
  for (const destination of wiring.destinations) {
    const ports = [...(wiring.inputsOf(destination.id) ?? [])].sort(([a], [b]) => a - b);
    for (const [port, { source, kept, currentSource }] of ports) {
      if (source === undefined) continue;
      const input: InputPort = { port, name: '', source };
      // Plan decision D2: a kept wire on an input the spec entry lists that the current state cannot identify is the
      // plan's conflict already. A rename changes the text of a kept wire, so the current state reads its text now.
      if (
        kept &&
        destination.listedPorts.has(port) &&
        current(destination.currentName, { ...input, source: currentSource ?? source }).kind !== 'found'
      )
        continue;
      const predicted = resolveWireSource(destination.name, input, wiring.devices, wiring.outputsOf);
      if (predicted.kind !== 'ambiguous') continue;
      listed.push(
        `'${destination.entry}' input ${port} from '${listedName(source.device)}' output ${source.port}: ${predicted.candidates.map(candidate).join(', ')} each list '${destination.name}' input ${port}`,
      );
    }
  }
  return listed;
}
