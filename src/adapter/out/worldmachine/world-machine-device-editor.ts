import type { DeviceEditPort } from '../../../application/port/out/device-edit-port.js';
import type { DeviceSummary } from '../../../domain/device.js';
import { WorldMachineError } from '../../../domain/errors.js';
import type { DeviceEnabledState, RenamedDevice } from '../../../domain/graph-edit.js';
import { buildCommand } from './command-builder.js';
import { listAllDevices, lookUpDevice } from './device-lookup.js';
import { assertReadableDeviceName, LISTED_NAME_LIMIT } from './device-reference.js';
import { readBack, requireLine, requireMatch } from './edit-checks.js';
import { parseDeviceInfo } from './parsers/device-info.js';
import { parseDeviceList } from './parsers/device-list.js';
import { unexpectedOutput } from './parsers/unexpected.js';
import { requireFrame, throwIfFailed } from './raw-response.js';
import type { WorldMachineSession } from './world-machine-session.js';

/** raw/p2b-graph-edits.txt l.5-6, raw/v6b-param-set.txt l.13-14: World Machine echoes the new device's name. */
const ADDED = /^Added '(.*)'$/;

/** Checks a new device name before anything is sent: readable in `device list`, and a safe final argument. */
function checkNewName(name: string): void {
  assertReadableDeviceName(name);
  // The tail checks `device rename #<id> <name>` gets once the id is known; the words do not change them.
  buildCommand(['device', 'rename'], name);
}

export class WorldMachineDeviceEditor implements DeviceEditPort {
  readonly #session: WorldMachineSession;

  constructor(session: WorldMachineSession) {
    this.#session = session;
  }

  async addDevice(type: string, name?: string): Promise<DeviceSummary> {
    const add = buildCommand(['device', 'add'], type);
    if (name !== undefined) checkNewName(name);
    // New ids are not the highest id plus one (spec fact 30): the new device is the one the second list adds.
    const before = new Set((await listAllDevices(this.#session)).map((device) => device.id));
    const responses = await this.#session.execute([add, 'device list']);
    const added = requireFrame(responses[0]);
    const list = requireFrame(responses[1]);
    throwIfFailed(added);
    const fresh = readBack(this.#session, () => {
      throwIfFailed(list);
      return parseDeviceList(list.output).filter((device) => !before.has(device.id));
    });
    // An unknown type is an `Error:` line, thrown above (raw/p2c-edits.txt l.17-18, spec fact 32). A new device in
    // the read-back means World Machine acted, whatever it printed; without one, the project is unchanged.
    if (fresh.length > 0) this.#session.markDirty();
    // Edit error codes (ruling K3): a missing confirmation is UNEXPECTED_OUTPUT; a confirmed command whose
    // read-back shows no effect is WM_COMMAND_FAILED (as for save, spec fact 23).
    const echoed = requireMatch(added, ADDED, 'device add')[1] ?? '';
    const device = fresh[0];
    if (device === undefined) {
      throw new WorldMachineError(
        'WM_COMMAND_FAILED',
        `World Machine confirmed adding '${echoed}', but device list shows no new device`,
        added.output.join('\n') || undefined,
      );
    }
    if (fresh.length > 1) throw unexpectedOutput('device list', list.output);
    // `device list` cuts names at 23 characters (spec fact 33), so the echo is compared by the same rule.
    if (echoed.slice(0, LISTED_NAME_LIMIT).trimEnd() !== device.name)
      throw unexpectedOutput('device add', added.output);
    if (name === undefined) return device;
    try {
      return await this.#rename(device.id, name);
    } catch (error) {
      if (!(error instanceof WorldMachineError)) throw error;
      throw new WorldMachineError(
        error.code,
        `Added #${device.id} '${device.name}', but the rename failed (${error.message}); rename it with rename_device, or remove it with undo.`,
        error.worldMachineMessage,
      );
    }
  }

  async renameDevice(device: string, name: string): Promise<RenamedDevice> {
    checkNewName(name);
    const target = await lookUpDevice(this.#session, device);
    return { device: await this.#rename(target.id, name), previousName: target.name };
  }

  async setDeviceEnabled(device: string, enabled: boolean): Promise<DeviceEnabledState> {
    const target = await lookUpDevice(this.#session, device);
    const ref = `#${target.id}`;
    const verb = enabled ? 'enable' : 'disable';
    // One batch: World Machine prints the same line whether or not the state changed (spec fact 25), so the device
    // is read back with `device info`, which acts on the selection (spec section 5).
    const responses = await this.#session.execute([
      buildCommand(['device', verb, ref]),
      buildCommand(['device', 'select', ref]),
      'device info',
    ]);
    const command = requireFrame(responses[0]);
    const select = requireFrame(responses[1]);
    const info = requireFrame(responses[2]);
    throwIfFailed(command);
    const after = readBack(this.#session, () => {
      throwIfFailed(select);
      throwIfFailed(info);
      return parseDeviceInfo(info.output);
    });
    // `device list` shows `[disabled]` reliably (spec facts 24 and 29), so it is the state before.
    const changed = after.enabled !== target.enabled;
    if (changed) this.#session.markDirty();
    // raw/p2b-graph-edits.txt l.34-35 and l.57-58.
    requireLine(command, `${enabled ? 'Enabled' : 'Disabled'}: ${ref}`, `device ${verb}`);
    if (after.enabled !== enabled) {
      throw new WorldMachineError(
        'WM_COMMAND_FAILED',
        `World Machine still reports ${ref} as ${after.enabled ? 'enabled' : 'disabled'}`,
        command.output.join('\n') || undefined,
      );
    }
    return { device: { id: target.id, name: after.name }, enabled: after.enabled, changed };
  }

  async deleteDevice(device: string): Promise<DeviceSummary> {
    const target = await lookUpDevice(this.#session, device);
    const ref = `#${target.id}`;
    const responses = await this.#session.execute([buildCommand(['device', 'delete', ref]), 'device list']);
    const deleted = requireFrame(responses[0]);
    const list = requireFrame(responses[1]);
    throwIfFailed(deleted);
    this.#session.markDirty();
    // raw/p2b-graph-edits.txt l.150-155: `Deleted: <ref>`, and the next `device list` no longer shows it.
    requireLine(deleted, `Deleted: ${ref}`, 'device delete');
    throwIfFailed(list);
    if (parseDeviceList(list.output).some((candidate) => candidate.id === target.id)) {
      throw new WorldMachineError(
        'WM_COMMAND_FAILED',
        `World Machine confirmed deleting ${ref}, but device list still shows it`,
        deleted.output.join('\n') || undefined,
      );
    }
    return target;
  }

  /** `device rename #<id> <name>`, then the device's `device list` row, which must show the new name. */
  async #rename(id: number, name: string): Promise<DeviceSummary> {
    const responses = await this.#session.execute([
      buildCommand(['device', 'rename', `#${id}`], name),
      'device list',
    ]);
    const renamed = requireFrame(responses[0]);
    const list = requireFrame(responses[1]);
    throwIfFailed(renamed);
    this.#session.markDirty();
    // raw/p2c-edits.txt l.28-29: `Renamed '#<id>' to '<name>'`, spaces in the name included (spec fact 32). World
    // Machine accepts a name another device has (l.72-80); later edits by that name are refused as ambiguous.
    requireLine(renamed, `Renamed '#${id}' to '${name}'`, 'device rename');
    throwIfFailed(list);
    const row = parseDeviceList(list.output).find((candidate) => candidate.id === id);
    if (row === undefined) throw unexpectedOutput('device list', list.output);
    if (row.name !== name) {
      // Confirmed, but the read-back shows another name (ruling K3).
      throw new WorldMachineError(
        'WM_COMMAND_FAILED',
        `World Machine confirmed renaming #${id} to '${name}', but device list shows '${row.name}'`,
        renamed.output.join('\n') || undefined,
      );
    }
    return row;
  }
}
