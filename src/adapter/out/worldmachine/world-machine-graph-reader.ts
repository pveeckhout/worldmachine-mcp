import type { PortTypeCatalogPort } from '../../../application/port/out/port-type-catalog-port.js';
import type { ProjectGraphReadPort } from '../../../application/port/out/project-graph-read-port.js';
import type { DeviceDetail, DeviceSummary } from '../../../domain/device.js';
import type { ProjectOverview } from '../../../domain/project.js';
import type { Scene } from '../../../domain/scene.js';
import { CatalogRegistry } from './catalog-registry.js';
import { buildCommand } from './command-builder.js';
import { deviceInfoCommands } from './device-info-read.js';
import { idOfReference, resolveDeviceReference } from './device-reference.js';
import { attachEnumOptions, ENUM_CATALOGS, type EnumCatalog } from './enum-options.js';
import { parseDeviceInfo } from './parsers/device-info.js';
import { parseDeviceList } from './parsers/device-list.js';
import { parseGroupList } from './parsers/group-list.js';
import { parseParamList } from './parsers/param-list.js';
import { parseSceneList, parseSceneShow } from './parsers/scene.js';
import { unexpectedOutput } from './parsers/unexpected.js';
import { parseWireList } from './parsers/wire-list.js';
import { requireFrame, throwIfFailed } from './raw-response.js';
import { attachPortTypes, NO_PORT_TYPES } from './world-machine-port-types.js';
import type { WorldMachineSession } from './world-machine-session.js';

export class WorldMachineGraphReader implements ProjectGraphReadPort {
  readonly #session: WorldMachineSession;
  readonly #registry: CatalogRegistry;
  readonly #portTypes: PortTypeCatalogPort;

  /**
   * `catalogs`: the enum options getDevice attaches, from the one of World Machine's build (enum-options design
   * section 4); tests pass a small one.
   * `catalogs` may be a live CatalogRegistry or an array (treated as shipped, never replaced).
   * `portTypes`: the port types it attaches (port-types design section 6); none unless main.ts passes the shipped
   * catalog (port-types plan decision D3).
   */
  constructor(
    session: WorldMachineSession,
    catalogs: CatalogRegistry | readonly EnumCatalog[] = ENUM_CATALOGS,
    portTypes: PortTypeCatalogPort = NO_PORT_TYPES,
  ) {
    this.#session = session;
    this.#registry =
      catalogs instanceof CatalogRegistry
        ? catalogs
        : new CatalogRegistry({ shippedEnums: catalogs, catalogDir: '' });
    this.#portTypes = portTypes;
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
    // The reference is checked before anything is sent, as the command builder does for the rest of the batch.
    buildCommand(['device', 'info'], device);
    const infoRead = await deviceInfoCommands(this.#session, device);
    const commands = [
      ...infoRead,
      buildCommand(['param', 'list'], device),
      buildCommand(['wire', 'list'], device),
      'device list',
    ];
    const responses = await this.#session.execute(commands);
    for (const response of responses) throwIfFailed(requireFrame(response));
    // Indexed from the end: the info read is one command or two (device-info-read.ts). Indexed one by one, because
    // destructuring an array under `noUncheckedIndexedAccess` types each element as possibly undefined.
    const info = requireFrame(responses[infoRead.length - 1]);
    const params = requireFrame(responses[infoRead.length]);
    const wires = requireFrame(responses[infoRead.length + 1]);
    const list = requireFrame(responses[infoRead.length + 2]);
    const detail = parseDeviceInfo(info.output);
    // Spec section 5: one batch, so the name is resolved after it. For an ambiguous name World Machine has already
    // read (or selected) one of the devices; neither is project state, so the refusal leaves nothing to undo.
    // A `#<id>` reference carries its id, so a list row the parser rejects cannot fail the read.
    const id =
      idOfReference(device) ?? idOfReference(resolveDeviceReference(parseDeviceList(list.output), device));
    // World Machine selected a device, but no listed name matches: nothing tells which id it has.
    if (id === undefined) throw unexpectedOutput('device list', list.output);
    // Enum-options design section 4. The build is read once World Machine has started (deviceInfoCommands starts it),
    // because only a start reads `system info` (world-machine-session.ts).
    const read = attachEnumOptions(
      {
        id,
        ...detail,
        parameters: parseParamList(params.output),
        ...parseWireList(wires.output),
        // Port-types design section 6: replaced below when the device is typed.
        portTypes: 'unknown',
      },
      this.#session.status().systemInfo?.build,
      this.#registry.enumCatalogs(),
    );
    // Port-types design section 6, also after the batch; the fingerprint is the domain's (plan decision D5).
    return attachPortTypes(read, this.#portTypes.portsOf(read.type));
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
