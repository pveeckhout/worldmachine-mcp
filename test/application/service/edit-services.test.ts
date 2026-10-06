import { describe, expect, it } from 'vitest';
import type { DeviceEditPort } from '../../../src/application/port/out/device-edit-port.js';
import type { ParameterEditPort } from '../../../src/application/port/out/parameter-edit-port.js';
import type { SceneEditPort } from '../../../src/application/port/out/scene-edit-port.js';
import type { WireEditPort } from '../../../src/application/port/out/wire-edit-port.js';
import type { WorldMachineSessionPort } from '../../../src/application/port/out/world-machine-session-port.js';
import { AddDeviceService } from '../../../src/application/service/add-device-service.js';
import { ConfigureSceneService } from '../../../src/application/service/configure-scene-service.js';
import { ConnectDevicesService } from '../../../src/application/service/connect-devices-service.js';
import { DeleteDeviceService } from '../../../src/application/service/delete-device-service.js';
import { DisconnectDevicesService } from '../../../src/application/service/disconnect-devices-service.js';
import { RenameDeviceService } from '../../../src/application/service/rename-device-service.js';
import { SetDeviceEnabledService } from '../../../src/application/service/set-device-enabled-service.js';
import { UpdateDeviceParametersService } from '../../../src/application/service/update-device-parameters-service.js';
import { WorldMachineError } from '../../../src/domain/errors.js';
import type { Scene } from '../../../src/domain/scene.js';
import type { SessionSummary } from '../../../src/domain/session.js';

const READY_DIRTY: SessionSummary = { state: 'ready', binding: { kind: 'fresh' }, dirty: true };
const GRADIENT = { id: 1, name: 'Gradient', enabled: true, bypassed: false };
const WIRE = {
  source: { id: 1, name: 'Gradient', port: 1 },
  destination: { id: 2, name: 'Combiner', port: 1 },
};
const SCENE: Scene = {
  name: 'Scene 1',
  index: 0,
  count: 1,
  originKm: { x: 0, y: 0 },
  sizeKm: { width: 8, height: 8 },
  resolution: 1024,
  locked: false,
};

function fakes() {
  const calls: string[] = [];
  const session: WorldMachineSessionPort = {
    ensureRunning: async () => {},
    status: () => ({ executable: '/wm', session: READY_DIRTY }),
    shutdown: async () => {},
    forgetReopen: () => void calls.push('forget'),
    exclusive: (action) => {
      calls.push('exclusive:start');
      return action().finally(() => void calls.push('exclusive:end'));
    },
  };
  const devices: DeviceEditPort = {
    addDevice: async (type, name) => {
      calls.push(`add:${type}:${name}`);
      return GRADIENT;
    },
    renameDevice: async (device, name) => {
      calls.push(`rename:${device}:${name}`);
      return { device: { ...GRADIENT, name }, previousName: 'Gradient' };
    },
    setDeviceEnabled: async (device, enabled) => {
      calls.push(`enable:${device}:${enabled}`);
      return { device: { id: 1, name: 'Gradient' }, enabled, changed: true };
    },
    deleteDevice: async (device) => {
      calls.push(`delete:${device}`);
      return GRADIENT;
    },
    organize: async () => void calls.push('organize'),
  };
  const parameters: ParameterEditPort = {
    updateParameters: async (device, values) => {
      calls.push(`params:${device}:${JSON.stringify(values)}`);
      return { device: { id: 1, name: 'Gradient' }, parameters: [] };
    },
  };
  const wires: WireEditPort = {
    connect: async (source, destination) => {
      calls.push(`connect:${source.device}.${source.port}:${destination.device}.${destination.port}`);
      return { ...WIRE, created: true };
    },
    disconnect: async (source, destination) => {
      calls.push(`disconnect:${source.device}:${destination.device}`);
      return { ...WIRE, removed: true };
    },
  };
  const scene: SceneEditPort = {
    configureScene: async (changes) => {
      calls.push(`scene:${JSON.stringify(changes)}`);
      return SCENE;
    },
  };
  return { calls, session, devices, parameters, wires, scene };
}

const inExclusive = (call: string) => ['exclusive:start', call, 'exclusive:end'];

describe('edit services', () => {
  it('AddDeviceService adds inside exclusive and returns the device with the session', async () => {
    const f = fakes();
    expect(
      await new AddDeviceService(f.session, f.devices).addDevice({ type: 'Gradient', name: 'Grad A' }),
    ).toEqual({
      device: GRADIENT,
      session: READY_DIRTY,
    });
    expect(f.calls).toEqual(inExclusive('add:Gradient:Grad A'));
  });

  it('RenameDeviceService renames inside exclusive', async () => {
    const f = fakes();
    const view = await new RenameDeviceService(f.session, f.devices).renameDevice({
      device: '#1',
      name: 'B',
    });
    expect(view).toEqual({
      device: { ...GRADIENT, name: 'B' },
      previousName: 'Gradient',
      session: READY_DIRTY,
    });
    expect(f.calls).toEqual(inExclusive('rename:#1:B'));
  });

  it('SetDeviceEnabledService sets the state inside exclusive', async () => {
    const f = fakes();
    const view = await new SetDeviceEnabledService(f.session, f.devices).setDeviceEnabled({
      device: 'Gradient',
      enabled: false,
    });
    expect(view).toEqual({
      device: { id: 1, name: 'Gradient' },
      enabled: false,
      changed: true,
      session: READY_DIRTY,
    });
    expect(f.calls).toEqual(inExclusive('enable:Gradient:false'));
  });

  it('DeleteDeviceService deletes inside exclusive and reports the deleted device', async () => {
    const f = fakes();
    expect(await new DeleteDeviceService(f.session, f.devices).deleteDevice({ device: '#1' })).toEqual({
      deleted: GRADIENT,
      session: READY_DIRTY,
    });
    expect(f.calls).toEqual(inExclusive('delete:#1'));
  });

  it('UpdateDeviceParametersService passes the parameters through inside exclusive', async () => {
    const f = fakes();
    const view = await new UpdateDeviceParametersService(f.session, f.parameters).updateDeviceParameters({
      device: '#1',
      parameters: { Width: 0.5 },
    });
    expect(view).toEqual({ device: { id: 1, name: 'Gradient' }, parameters: [], session: READY_DIRTY });
    expect(f.calls).toEqual(inExclusive('params:#1:{"Width":0.5}'));
  });

  it('ConnectDevicesService and DisconnectDevicesService run inside exclusive', async () => {
    const f = fakes();
    const command = { source: { device: '#1', port: 1 }, destination: { device: '#2', port: 2 } };
    expect(await new ConnectDevicesService(f.session, f.wires).connectDevices(command)).toEqual({
      ...WIRE,
      created: true,
      session: READY_DIRTY,
    });
    expect(await new DisconnectDevicesService(f.session, f.wires).disconnectDevices(command)).toEqual({
      ...WIRE,
      removed: true,
      session: READY_DIRTY,
    });
    expect(f.calls).toEqual([...inExclusive('connect:#1.1:#2.2'), ...inExclusive('disconnect:#1:#2')]);
  });

  it('ConfigureSceneService configures inside exclusive and returns the scene', async () => {
    const f = fakes();
    expect(await new ConfigureSceneService(f.session, f.scene).configureScene({ resolution: 2049 })).toEqual({
      scene: SCENE,
      session: READY_DIRTY,
    });
    expect(f.calls).toEqual(inExclusive('scene:{"resolution":2049}'));
  });

  it('propagates an edit error and still leaves the exclusive section', async () => {
    const f = fakes();
    const failing: DeviceEditPort = {
      ...f.devices,
      deleteDevice: async () => {
        throw new WorldMachineError('REFUSED', "No device 'x' in the current project; see list_devices");
      },
    };
    await expect(
      new DeleteDeviceService(f.session, failing).deleteDevice({ device: 'x' }),
    ).rejects.toMatchObject({
      code: 'REFUSED',
    });
    expect(f.calls).toEqual(['exclusive:start', 'exclusive:end']);
  });
});
