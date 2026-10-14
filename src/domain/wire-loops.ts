import type { InputPort, OutputPort, PortLink } from './device.js';
import { listedName } from './device-name.js';
import type { GraphState, PlanConflict, PlanStep } from './graph-plan.js';
import type { GraphSpec } from './graph-spec.js';
import { predictWiring } from './predicted-wiring.js';
import { resolveWireSource, sourceCandidates } from './wire-source.js';

/**
 * One hop along a predicted target line: the device it may reach and that device's listed name; `shared` is the
 * source's listed name whose wires cannot be told apart, undefined for a certain hop.
 */
type Hop = { readonly id: number; readonly name: string; readonly shared: string | undefined };

/** A path the search found: the hops from the connect's destination to its source, and the first shared name. */
type Path = { readonly hops: readonly Hop[]; readonly through: string | undefined };

/**
 * Wire-loops design section 2: the plan's connects that would close a loop in the wiring after the apply. A loop
 * whose hops are all certain is a conflict on the destination's entry, since World Machine refuses the wire that
 * closes it (fact 99); a loop with an uncertain hop is listed in `possibleLoops` and refuses nothing. Pure. Connects
 * are searched in step order; a self-wire has no step (fact 98's conflict), nor has a connect the plan refuses.
 */
export function wireLoops(
  spec: GraphSpec,
  state: GraphState,
  steps: readonly PlanStep[],
): { readonly conflicts: readonly PlanConflict[]; readonly possibleLoops: readonly string[] } {
  const wiring = predictWiring(spec, state, steps);
  const nameOf = (id: number): string | undefined => wiring.devices.find((device) => device.id === id)?.name;
  const currentOutputsOf = (id: number): readonly OutputPort[] | undefined =>
    state.details.find((detail) => detail.id === id)?.outputs;

  // Wire-loops plan decision D2: the input a connect step feeds has a known source, by id or add-step placeholder.
  const connects: {
    readonly step: PlanStep & { readonly op: 'connect' };
    readonly from: number;
    readonly to: number;
  }[] = [];
  const connected = new Map<string, number>();
  for (const step of steps) {
    if (step.op !== 'connect') continue;
    const to = wiring.idOf(step.device, step.id);
    const from = wiring.idOf(step.source.device, step.source.id);
    // A type guard: planGraph gives every connect an existing id or a device its add step plans. A self-wire has no
    // step (fact 98's conflict); the guard keeps it out of the search should one be given.
    if (to === undefined || from === undefined || to === from) continue;
    connects.push({ step, from, to });
    connected.set(`${to}.${step.port}`, from);
  }

  /**
   * The source an input keeps: a managed device's as the steps leave it (none once a disconnect or remove clears
   * it), any other read device's as it is now; undefined for an unread device (wire-loops plan decision D3: phase four
   * reads every device a current line names, so an unread one is named only by a connect's line, whose device is the
   * managed destination).
   */
  const keptSourceOf = (id: number, port: number): PortLink | undefined => {
    const managed = wiring.inputsOf(id);
    if (managed !== undefined) return managed.get(port)?.source;
    return state.details.find((detail) => detail.id === id)?.inputs.find((input) => input.port === port)
      ?.source;
  };

  /**
   * Wire-loops design section 2 (revision 1) and plan decision D2: the devices a target line of `from` reaches. Of the
   * devices of the line's name, one whose input a connect step feeds is reached, certainly, only from that step's
   * source. One whose input keeps a wire showing `from`'s name is reached certainly when the current state identifies
   * `from` as its source, and uncertainly when the current state finds several candidates with `from` among them, finds
   * none (`unknown`, which identifies no other device), or when a device of `from`'s name was not read, since
   * resolveWireSource never guesses (Codex round 1, B1).
   */
  const hopsCache = new Map<number, readonly Hop[]>();
  const hopsOf = (from: number): readonly Hop[] => {
    const cached = hopsCache.get(from);
    if (cached !== undefined) return cached;
    const own = nameOf(from);
    const hops: Hop[] = [];
    for (const output of wiring.outputsOf(from) ?? []) {
      for (const target of output.targets) {
        const name = listedName(target.device);
        const named = wiring.devices.filter((device) => device.name === name);
        for (const { id } of named) {
          const known = connected.get(`${id}.${target.port}`);
          if (known !== undefined) {
            if (known === from) hops.push({ id, name, shared: undefined });
            continue;
          }
          const source = keptSourceOf(id, target.port);
          if (source === undefined || own === undefined || listedName(source.device) !== own) continue;
          const input: InputPort = { port: target.port, name: '', source };
          const readable = sourceCandidates(input, state.devices).every(
            (candidate) => currentOutputsOf(candidate.id) !== undefined,
          );
          if (!readable) {
            hops.push({ id, name, shared: own });
            continue;
          }
          const resolved = resolveWireSource(name, input, state.devices, currentOutputsOf);
          if (resolved.kind === 'found' && resolved.id === from) hops.push({ id, name, shared: undefined });
          else if (
            resolved.kind === 'unknown' ||
            (resolved.kind === 'ambiguous' && resolved.candidates.includes(from))
          )
            hops.push({ id, name, shared: own });
        }
      }
    }
    hopsCache.set(from, hops);
    return hops;
  };

  /** Depth first from `start` to `goal`, each device visited once; `certainOnly` follows certain hops only. */
  const search = (start: number, goal: number, certainOnly: boolean): Path | undefined => {
    const visited = new Set<number>([start]);
    const visit = (id: number, path: readonly Hop[], through: string | undefined): Path | undefined => {
      for (const hop of hopsOf(id)) {
        if (certainOnly && hop.shared !== undefined) continue;
        const via = through ?? hop.shared;
        if (hop.id === goal) return { hops: [...path, hop], through: via };
        if (visited.has(hop.id)) continue;
        visited.add(hop.id);
        const found = visit(hop.id, [...path, hop], via);
        if (found !== undefined) return found;
      }
      return undefined;
    };
    return visit(start, [], undefined);
  };

  /**
   * Wire-loops design section 2: a device as the plan names it, its entry or label when the spec manages it, its
   * listed name otherwise, followed by `#<id>` when several listed devices have that name (wire-loops plan decision D5).
   */
  const shown = ({ id, name }: Hop): string => {
    const managed = wiring.destinations.find((destination) => destination.id === id);
    if (managed !== undefined) return managed.entry;
    return state.devices.filter((device) => device.name === name).length > 1 ? `${name} #${id}` : name;
  };

  const conflicts: PlanConflict[] = [];
  const possibleLoops: string[] = [];
  for (const { step, from, to } of connects) {
    const wire = `input ${step.port} from '${step.source.device}' output ${step.source.port}`;
    // Wire-loops plan decision D4: a certain path first, so a device an uncertain hop reached first cannot hide one.
    const loop = search(to, from, true);
    if (loop !== undefined) {
      const path = [step.device, ...loop.hops.map(shown)].join(' -> ');
      conflicts.push({
        entry: step.device,
        reason: `${wire} would close a loop (${path}); World Machine refuses a wire that closes a loop (fact 99)`,
      });
      continue;
    }
    // A path the certain search missed has an uncertain hop, so `through` is set.
    const possible = search(to, from, false);
    if (possible?.through !== undefined) {
      possibleLoops.push(
        `'${step.device}' ${wire} may close a loop through '${possible.through}', whose wires cannot be told apart`,
      );
    }
  }
  return { conflicts, possibleLoops };
}
