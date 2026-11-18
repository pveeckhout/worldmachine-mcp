import { describe, expect, it } from 'vitest';
import type { WireEditPort } from '../../../src/application/port/out/wire-edit-port.js';
import type { WorldMachineSessionPort } from '../../../src/application/port/out/world-machine-session-port.js';
import { ConnectDevicesService } from '../../../src/application/service/connect-devices-service.js';
import { WireVerdicts } from '../../../src/application/service/wire-verdicts.js';
import type { WireTyping } from '../../../src/domain/catalog.js';
import { WorldMachineError } from '../../../src/domain/errors.js';
import type { SessionSummary } from '../../../src/domain/session.js';
import { sampleDerivedPortTypes } from '../../support/port-types.js';
import { memoryRecorder } from '../../support/wire-verdicts.js';

const READY: SessionSummary = { state: 'ready', binding: { kind: 'fresh' }, dirty: true };
const session = {
  status: () => ({ executable: null, session: READY, generation: 1 }),
  exclusive: <T>(action: () => Promise<T>) => action(),
} as unknown as WorldMachineSessionPort;
const typing: WireTyping = {
  output: { type: 'Create Water', port: 'Water System' },
  input: { type: 'Height Output', port: 'Primary Input' },
  predicted: 'compatible',
};
const WIRE = {
  source: { id: 1, name: 'Lake', port: 1 },
  destination: { id: 2, name: 'Out', port: 1 },
  created: true,
};
const command = { source: { device: '#1' }, destination: { device: '#2' } };

describe('ConnectDevicesService verdicts', () => {
  it('records a refusal, rethrows with the verdict added to the details', async () => {
    const store = memoryRecorder();
    const refusal = new WorldMachineError('WM_COMMAND_FAILED', 'incompatible types?', 'wm said no', {
      typing,
    });
    const wires = {
      connect: async () => {
        throw refusal;
      },
    } as unknown as WireEditPort;
    const service = new ConnectDevicesService(
      session,
      wires,
      new WireVerdicts(sampleDerivedPortTypes, store),
    );
    const error = await service.connectDevices(command).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WorldMachineError);
    expect(error).toMatchObject({
      code: 'WM_COMMAND_FAILED',
      message: 'incompatible types?',
      worldMachineMessage: 'wm said no',
      details: { typing, verdict: { verdict: 'refused', outcome: 'recorded' } },
    });
    expect(store.recorded).toHaveLength(1);
  });

  it('rethrows an error that is not a WorldMachineError unchanged', async () => {
    const boom = new Error('boom');
    const wires = {
      connect: async () => {
        throw boom;
      },
    } as unknown as WireEditPort;
    const service = new ConnectDevicesService(
      session,
      wires,
      new WireVerdicts(sampleDerivedPortTypes, memoryRecorder()),
    );
    await expect(service.connectDevices(command)).rejects.toBe(boom);
  });

  it('adds the verdict of an accepted wire the catalog called incompatible, without the typing', async () => {
    const store = memoryRecorder();
    const wires = {
      connect: async () => ({ ...WIRE, typing: { ...typing, predicted: 'incompatible' } }),
    } as unknown as WireEditPort;
    const service = new ConnectDevicesService(
      session,
      wires,
      new WireVerdicts(sampleDerivedPortTypes, store),
    );
    const view = await service.connectDevices(command);
    expect(view).toEqual({
      ...WIRE,
      verdict: expect.objectContaining({ verdict: 'accepted', outcome: 'recorded' }),
      session: READY,
    });
    expect(store.recorded).toHaveLength(1);
  });

  it('adds no verdict when World Machine agreed', async () => {
    const wires = { connect: async () => ({ ...WIRE, typing }) } as unknown as WireEditPort;
    const service = new ConnectDevicesService(
      session,
      wires,
      new WireVerdicts(sampleDerivedPortTypes, memoryRecorder()),
    );
    expect(await service.connectDevices(command)).toEqual({ ...WIRE, session: READY });
  });
});
