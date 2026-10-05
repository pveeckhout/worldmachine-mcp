import type { WireEditPort } from '../../../application/port/out/wire-edit-port.js';
import type { InputPort } from '../../../domain/device.js';
import { WorldMachineError } from '../../../domain/errors.js';
import type { WireConnection, WireDisconnection, WireEnd, WireEndpoint } from '../../../domain/graph-edit.js';
import { buildCommand } from './command-builder.js';
import { listAllDevices } from './device-lookup.js';
import { findListedDevice, LISTED_NAME_LIMIT } from './device-reference.js';
import { readBack, requireLine } from './edit-checks.js';
import { parseWireList } from './parsers/wire-list.js';
import { requireFrame, throwIfFailed } from './raw-response.js';
import type { WorldMachineSession } from './world-machine-session.js';

/**
 * World Machine uses port 1 on both ends when a reference has no `.port` (raw/p2b-graph-edits.txt l.22-23,
 * raw/v4-quoting.txt l.115-116; l.127-128 shows that it does not move on to a free input).
 */
const DEFAULT_PORT = 1;

type WirePlan = {
  readonly source: WireEnd;
  readonly destination: WireEnd;
  /** `#<id>`, or `#<id>.<port>` when the call gave a port (raw/help.txt: `wire connect <source>[.port] <dest>[.port]`). */
  readonly sourceArgument: string;
  readonly destinationArgument: string;
  readonly listDestination: string;
  /** Another listed device has the source's exact name; `wire list` names devices, so it cannot tell them apart. */
  readonly sourceNameShared: boolean;
  /** The destination's input already shows a wire from the source's name and port. */
  readonly present: boolean;
};

const argument = (id: number, port: number | undefined): string =>
  port === undefined ? `#${id}` : `#${id}.${port}`;

/**
 * Whether a name `wire list` prints is the device `device list` lists as `listed`. `device list` shows the first 23
 * characters of a name (spec fact 33) and the parser trims trailing whitespace from them, so a name whose 23rd
 * character is a space lists shorter than 23. Truncating and trimming `printed` the same way gives the listed text at
 * any length, whether or not `wire list` truncates too (ruling K4').
 */
function sameDeviceName(printed: string, listed: string): boolean {
  return printed.slice(0, LISTED_NAME_LIMIT).trimEnd() === listed;
}

/**
 * Whether `input` shows a wire from `end`. `wire list` names the source device and its output port
 * (raw/p2b-graph-edits.txt l.28); a renamed device by its current name (raw/p2c-edits.txt l.92, spec fact 34).
 */
function linkedFrom(input: InputPort | undefined, end: WireEnd): boolean {
  const source = input?.source;
  return source !== undefined && sameDeviceName(source.device, end.name) && source.port === end.port;
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

  constructor(session: WorldMachineSession) {
    this.#session = session;
  }

  async connect(source: WireEndpoint, destination: WireEndpoint): Promise<WireConnection> {
    const plan = await this.#plan(source, destination);
    const ends = { source: plan.source, destination: plan.destination };
    // An existing wire changes nothing (idempotent, spec section 7). With a shared source name, World Machine decides.
    if (plan.present && !plan.sourceNameShared) return { ...ends, created: false };
    const responses = await this.#session.execute([
      buildCommand(['wire', 'connect', plan.sourceArgument, plan.destinationArgument]),
      plan.listDestination,
    ]);
    const connected = requireFrame(responses[0]);
    const after = requireFrame(responses[1]);
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
    // wire sends nothing.
    if (!plan.present) return { ...ends, removed: false };
    if (plan.sourceNameShared) {
      throw new WorldMachineError(
        'REFUSED',
        `Several devices are named '${plan.source.name}', and wire list names devices, so a removed wire could not be confirmed; rename one of them first`,
      );
    }
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

  /** `device list` and the destination's `wire list`, run before any change (spec section 7). */
  async #plan(source: WireEndpoint, destination: WireEndpoint): Promise<WirePlan> {
    checkPort(source.port);
    checkPort(destination.port);
    const devices = await listAllDevices(this.#session);
    const from = findListedDevice(devices, source.device);
    const to = findListedDevice(devices, destination.device);
    const listDestination = buildCommand(['wire', 'list', `#${to.id}`]);
    const before = await this.#session.executeOne(listDestination);
    throwIfFailed(before);
    const inputs = parseWireList(before.output).inputs;
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
      // Devices with equal listed names cannot be told apart by `wire list` (ruling K4').
      sourceNameShared: devices.filter((device) => device.name === from.name).length > 1,
      present: linkedFrom(input, sourceEnd),
    };
  }
}
