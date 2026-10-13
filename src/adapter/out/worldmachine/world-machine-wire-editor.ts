import type { PortTypeCatalogPort } from '../../../application/port/out/port-type-catalog-port.js';
import type { WireEditPort } from '../../../application/port/out/wire-edit-port.js';
import type { DeviceSummary, InputPort, OutputPort } from '../../../domain/device.js';
import { listedName } from '../../../domain/device-name.js';
import { WorldMachineError } from '../../../domain/errors.js';
import type { WireConnection, WireDisconnection, WireEnd, WireEndpoint } from '../../../domain/graph-edit.js';
import { type PortNames, refusalTypes, typedPorts } from '../../../domain/port-types.js';
import { resolveWireSource, sharedNameClause, sourceCandidates } from '../../../domain/wire-source.js';
import { buildCommand } from './command-builder.js';
import { listAllDevices } from './device-lookup.js';
import { findListedDevice, matchesListedName } from './device-reference.js';
import { readBack, requireLine } from './edit-checks.js';
import { parseWireList } from './parsers/wire-list.js';
import { type RawResponse, requireFrame, throwIfFailed } from './raw-response.js';
import { NO_PORT_TYPES } from './world-machine-port-types.js';
import type { WorldMachineSession } from './world-machine-session.js';

/**
 * World Machine uses port 1 on both ends when a reference has no `.port` (raw/p2b-graph-edits.txt l.22-23,
 * raw/v4-quoting.txt l.115-116; l.127-128 shows that it does not move on to a free input).
 */
const DEFAULT_PORT = 1;

/**
 * raw/reach-scaling-inputs.txt l.604-605, raw/create-water-sea.txt l.194-195: World Machine's refusal of a wire
 * between ports of other types (port-types design section 2).
 */
const INCOMPATIBLE = 'Error: Error: Failed to create connection (incompatible types?)';

type WirePlan = {
  readonly source: WireEnd;
  readonly destination: WireEnd;
  /** `#<id>`, or `#<id>.<port>` when the call gave a port (raw/help.txt: `wire connect <source>[.port] <dest>[.port]`). */
  readonly sourceArgument: string;
  readonly destinationArgument: string;
  readonly listDestination: string;
  /** The destination's input is wired from the source device and port (v3 spec revision 6). */
  readonly present: boolean;
  /** Port-types plan decision D9: the listed types (fact 81) and the destination's ports, for a refusal's text. */
  readonly sourceType: string;
  readonly destinationType: string;
  readonly destinationPorts: PortNames;
};

const argument = (id: number, port: number | undefined): string =>
  port === undefined ? `#${id}` : `#${id}.${port}`;

/**
 * Whether `input` shows a wire from `end`'s name and port. `wire list` names the source device and its output port
 * (raw/p2b-graph-edits.txt l.28); a renamed device by its current name (raw/p2c-edits.txt l.92, spec fact 34). The
 * checks after a change use it: an input holds one wire.
 */
function linkedFrom(input: InputPort | undefined, end: WireEnd): boolean {
  const source = input?.source;
  return source !== undefined && matchesListedName(source.device, end.name) && source.port === end.port;
}

function inputOf(output: readonly string[], port: number): InputPort | undefined {
  return parseWireList(output).inputs.find((candidate) => candidate.port === port);
}

function checkPort(port: number | undefined): void {
  if (port !== undefined && !(Number.isSafeInteger(port) && port >= 1)) {
    throw new WorldMachineError('REFUSED', `Ports are whole numbers from 1, not ${port}`);
  }
}

export class WorldMachineWireEditor implements WireEditPort {
  readonly #session: WorldMachineSession;
  readonly #portTypes: PortTypeCatalogPort;

  /** `portTypes`: the types a refusal names (port-types design section 6); none unless main.ts passes the catalog. */
  constructor(session: WorldMachineSession, portTypes: PortTypeCatalogPort = NO_PORT_TYPES) {
    this.#session = session;
    this.#portTypes = portTypes;
  }

  async connect(source: WireEndpoint, destination: WireEndpoint): Promise<WireConnection> {
    const plan = await this.#plan(source, destination);
    const ends = { source: plan.source, destination: plan.destination };
    // An existing wire changes nothing (idempotent, spec section 7). An input wired from another device is sent, and
    // World Machine itself refuses it (fact 34).
    if (plan.present) return { ...ends, created: false };
    const responses = await this.#session.execute([
      buildCommand(['wire', 'connect', plan.sourceArgument, plan.destinationArgument]),
      plan.listDestination,
    ]);
    const connected = requireFrame(responses[0]);
    const after = requireFrame(responses[1]);
    // Port-types design section 6: no pre-check; World Machine decides, and its refusal gains the types.
    if (connected.errors.some((line) => line.trimEnd() === INCOMPATIBLE))
      throw await this.#incompatible(plan, connected);
    throwIfFailed(connected);
    this.#session.markDirty();
    // raw/p2b-graph-edits.txt l.22-23; with explicit ports raw/p2c-edits.txt l.108-109 (spec facts 26 and 34).
    requireLine(
      connected,
      `Connected '#${plan.source.id}' [${plan.source.port}] -> '#${plan.destination.id}' [${plan.destination.port}]`,
      'wire connect',
    );
    throwIfFailed(after);
    if (!linkedFrom(inputOf(after.output, plan.destination.port), plan.source)) {
      throw new WorldMachineError(
        'WM_COMMAND_FAILED',
        `World Machine confirmed the wire, but wire list of #${plan.destination.id} does not show it`,
        connected.output.join('\n') || undefined,
      );
    }
    return { ...ends, created: true };
  }

  async disconnect(source: WireEndpoint, destination: WireEndpoint): Promise<WireDisconnection> {
    const plan = await this.#plan(source, destination);
    const ends = { source: plan.source, destination: plan.destination };
    // Spec section 7: World Machine confirms a disconnect whether or not the wire existed (fact 26), so an absent
    // wire, or one from another device, sends nothing.
    if (!plan.present) return { ...ends, removed: false };
    const responses = await this.#session.execute([
      buildCommand(['wire', 'disconnect', plan.sourceArgument, plan.destinationArgument]),
      plan.listDestination,
    ]);
    const disconnected = requireFrame(responses[0]);
    const after = requireFrame(responses[1]);
    throwIfFailed(disconnected);
    const stillThere = readBack(this.#session, () => {
      throwIfFailed(after);
      return linkedFrom(inputOf(after.output, plan.destination.port), plan.source);
    });
    if (!stillThere) this.#session.markDirty();
    // raw/p2b-graph-edits.txt l.117-118 and l.135-136, raw/p2c-edits.txt l.120-121.
    requireLine(
      disconnected,
      `Disconnected '#${plan.source.id}' [${plan.source.port}] -> '#${plan.destination.id}' [${plan.destination.port}]`,
      'wire disconnect',
    );
    if (stillThere) {
      throw new WorldMachineError(
        'WM_COMMAND_FAILED',
        `World Machine reported the disconnection, but wire list of #${plan.destination.id} still shows the wire`,
        disconnected.output.join('\n') || undefined,
      );
    }
    return { ...ends, removed: true };
  }

  /**
   * Port-types design section 6 and plan decision D9: World Machine's refusal, as throwIfFailed gives it, with
   * `: output <p> is <type>; input <q> accepts <names>` appended when both ends are typed. The destination's ports are
   * the plan's `wire list`; the source's come from one `wire list` read now, only when the destination's input is
   * typed. A WorldMachineError of that read leaves the refusal as World Machine gave it.
   */
  async #incompatible(plan: WirePlan, connected: RawResponse): Promise<WorldMachineError> {
    const refusal = (types: string) =>
      new WorldMachineError(
        'WM_COMMAND_FAILED',
        `World Machine rejected "${connected.command}"${types}`,
        connected.errors.join('\n'),
      );
    const input = typedPorts(
      plan.destinationPorts,
      this.#portTypes.portsOf(plan.destinationType),
    )?.inputs.find((candidate) => candidate.port === plan.destination.port);
    if (input === undefined) return refusal('');
    let sourcePorts: PortNames;
    try {
      const listed = await this.#session.executeOne(buildCommand(['wire', 'list', `#${plan.source.id}`]));
      throwIfFailed(listed);
      sourcePorts = parseWireList(listed.output);
    } catch (error) {
      if (error instanceof WorldMachineError) return refusal('');
      throw error;
    }
    const output = typedPorts(sourcePorts, this.#portTypes.portsOf(plan.sourceType))?.outputs.find(
      (candidate) => candidate.port === plan.source.port,
    );
    return refusal(output === undefined ? '' : refusalTypes(output, input));
  }

  /** `device list`, the destination's `wire list`, and the candidates' when needed, all before any change. */
  async #plan(source: WireEndpoint, destination: WireEndpoint): Promise<WirePlan> {
    checkPort(source.port);
    checkPort(destination.port);
    const devices = await listAllDevices(this.#session);
    const from = findListedDevice(devices, source.device);
    const to = findListedDevice(devices, destination.device);
    const listDestination = buildCommand(['wire', 'list', `#${to.id}`]);
    const before = await this.#session.executeOne(listDestination);
    throwIfFailed(before);
    const listedPorts = parseWireList(before.output);
    const inputs = listedPorts.inputs;
    const destinationEnd: WireEnd = { id: to.id, name: to.name, port: destination.port ?? DEFAULT_PORT };
    const input = inputs.find((candidate) => candidate.port === destinationEnd.port);
    if (input === undefined) {
      // World Machine would answer `Error: Error: Input port not found on '#<id>'` (raw/p2c-edits.txt l.126-127, spec
      // fact 34); refusing here names the ports that exist and sends nothing.
      const ports = inputs.map((candidate) => `${candidate.port} (${candidate.name})`).join(', ') || 'none';
      throw new WorldMachineError(
        'REFUSED',
        `#${to.id} '${to.name}' has no input port ${destinationEnd.port}; its input ports are: ${ports}`,
      );
    }
    const sourceEnd: WireEnd = { id: from.id, name: from.name, port: source.port ?? DEFAULT_PORT };
    return {
      source: sourceEnd,
      destination: destinationEnd,
      sourceArgument: argument(from.id, source.port),
      destinationArgument: argument(to.id, destination.port),
      listDestination,
      present: await this.#present(devices, to, input, sourceEnd),
      sourceType: from.kind ?? from.name,
      destinationType: to.kind ?? to.name,
      destinationPorts: listedPorts,
    };
  }

  /**
   * Whether the destination's `input` is wired from `source`. An input that shows another name or port, or no wire,
   * is not (ruling 4, as before revision 6). One listed device with the source's name is that device (spec fact 34).
   * When several share it, `wire list` of each runs before any change, and resolveWireSource takes the one whose
   * output lists this input (v3 spec revision 6, fact 82); one it cannot identify is refused.
   */
  async #present(
    devices: readonly DeviceSummary[],
    to: DeviceSummary,
    input: InputPort,
    source: WireEnd,
  ): Promise<boolean> {
    const shown = input.source;
    if (shown === undefined || !linkedFrom(input, source)) return false;
    const candidates = sourceCandidates(input, devices);
    if (candidates.length < 2) return true;
    const responses = await this.#session.execute(
      candidates.map((candidate) => buildCommand(['wire', 'list', `#${candidate.id}`])),
    );
    const outputs = new Map<number, readonly OutputPort[]>();
    for (const [index, candidate] of candidates.entries()) {
      const response = requireFrame(responses[index]);
      throwIfFailed(response);
      outputs.set(candidate.id, parseWireList(response.output).outputs);
    }
    const resolved = resolveWireSource(to.name, input, devices, (id) => outputs.get(id));
    if (resolved.kind === 'found') return resolved.id === source.id && resolved.port === source.port;
    throw new WorldMachineError(
      'REFUSED',
      `Input ${input.port} of #${to.id} '${to.name}' is wired from '${listedName(shown.device)}', ${sharedNameClause(
        candidates.map((candidate) => candidate.id),
        resolved,
        to.name,
        input.port,
      )}, so wire list cannot tell which one feeds it; nothing was changed`,
    );
  }
}
