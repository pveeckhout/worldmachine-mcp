import type { ProjectGraphReadPort } from '../../../application/port/out/project-graph-read-port.js';
import type { DeviceDetail, DeviceSummary } from '../../../domain/device.js';
import type { ProjectOverview } from '../../../domain/project.js';
import type { Scene } from '../../../domain/scene.js';
import { buildCommand } from './command-builder.js';
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

  constructor(session: WorldMachineSession) {
    this.#session = session;
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
    const byId = /^#(\d+)$/.exec(device);
    const id = byId ? Number(byId[1]) : parseDeviceList(list.output).find((d) => d.name === detail.name)?.id;
    if (id === undefined) throw unexpectedOutput('device list', list.output);
    return {
      id,
      ...detail,
      parameters: parseParamList(params.output),
      ...parseWireList(wires.output),
    };
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
