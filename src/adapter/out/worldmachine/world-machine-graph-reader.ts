import type { ProjectGraphReadPort } from '../../../application/port/out/project-graph-read-port.js';
import type { DeviceDetail, DeviceSummary } from '../../../domain/device.js';
import type { ProjectOverview } from '../../../domain/project.js';
import type { Scene } from '../../../domain/scene.js';
import { buildCommand } from './command-builder.js';
import { idOfReference, resolveDeviceReference } from './device-reference.js';
import { attachEnumOptions, ENUM_CATALOG, type EnumCatalog } from './enum-options.js';
import { parseDeviceInfo } from './parsers/device-info.js';
import { parseDeviceList } from './parsers/device-list.js';
import { parseGroupList } from './parsers/group-list.js';
import { parseParamList } from './parsers/param-list.js';
import { parseSceneList, parseSceneShow } from './parsers/scene.js';
import { unexpectedOutput } from './parsers/unexpected.js';
import { parseWireList } from './parsers/wire-list.js';
import { requireFrame, throwIfFailed } from './raw-response.js';
import type { WorldMachineSession } from './world-machine-session.js';

export class WorldMachineGraphReader implements ProjectGraphReadPort {
  readonly #session: WorldMachineSession;
  readonly #catalog: EnumCatalog;

  /** `catalog`: the enum options getDevice attaches (enum-options design section 4); tests pass a small one. */
  constructor(session: WorldMachineSession, catalog: EnumCatalog = ENUM_CATALOG) {
    this.#session = session;
    this.#catalog = catalog;
  }

  async listDevices(filter?: string): Promise<DeviceSummary[]> {
    this.#session.assertAcceptingCalls();
    const command =
      filter === undefined ? buildCommand(['device', 'list']) : buildCommand(['device', 'list'], filter);
    const response = await this.#session.executeOne(command);
    throwIfFailed(response);
    return parseDeviceList(response.output, filter !== undefined);
  }

  async getDevice(device: string): Promise<DeviceDetail> {
    this.#session.assertAcceptingCalls();
    const commands = [
      buildCommand(['device', 'select'], device),
      'device info',
      buildCommand(['param', 'list'], device),
      buildCommand(['wire', 'list'], device),
      'device list',
    ];
    const responses = await this.#session.execute(commands);
    // Indexed one by one: destructuring an array under `noUncheckedIndexedAccess` types each element as possibly undefined.
    const select = requireFrame(responses[0]);
    const info = requireFrame(responses[1]);
    const params = requireFrame(responses[2]);
    const wires = requireFrame(responses[3]);
    const list = requireFrame(responses[4]);
    for (const response of [select, info, params, wires, list]) throwIfFailed(response);
    const detail = parseDeviceInfo(info.output);
    // Spec section 5: one batch, so the name is resolved after it. For an ambiguous name World Machine has already
    // selected one of the devices; selection is not project state, so the refusal leaves nothing to undo.
    // A `#<id>` reference carries its id, so a list row the parser rejects cannot fail the read.
    const id =
      idOfReference(device) ?? idOfReference(resolveDeviceReference(parseDeviceList(list.output), device));
    // World Machine selected a device, but no listed name matches: nothing tells which id it has.
    if (id === undefined) throw unexpectedOutput('device list', list.output);
    // Enum-options design section 4. The build is read after the batch: the batch starts World Machine when it was
    // not running, and only a start reads `system info` (world-machine-session.ts).
    return attachEnumOptions(
      {
        id,
        ...detail,
        parameters: parseParamList(params.output),
        ...parseWireList(wires.output),
        // Port-types design section 6: untyped until plan Task 5 attaches the catalog's types.
        portTypes: 'unknown',
      },
      this.#session.status().systemInfo?.build,
      this.#catalog,
    );
  }

  async getScene(): Promise<Scene> {
    const response = await this.#session.executeOne('scene show');
    throwIfFailed(response);
    return parseSceneShow(response.output);
  }

  async inspectProject(): Promise<ProjectOverview> {
    const commands = ['scene show', 'scene list', 'device list', 'group list'];
    const responses = await this.#session.execute(commands);
    const scene = requireFrame(responses[0]);
    const scenes = requireFrame(responses[1]);
    const devices = requireFrame(responses[2]);
    const groups = requireFrame(responses[3]);
    for (const response of [scene, scenes, devices, groups]) throwIfFailed(response);
    const deviceList = parseDeviceList(devices.output);
    return {
      scene: parseSceneShow(scene.output),
      scenes: parseSceneList(scenes.output),
      deviceCount: deviceList.length,
      devices: deviceList,
      groups: parseGroupList(groups.output),
    };
  }
}
