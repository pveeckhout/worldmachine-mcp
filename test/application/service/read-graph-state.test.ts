import { describe, expect, it } from 'vitest';
import type { ProjectGraphReadPort } from '../../../src/application/port/out/project-graph-read-port.js';
import type { WorldMachineSessionPort } from '../../../src/application/port/out/world-machine-session-port.js';
import { readGraphState } from '../../../src/application/service/read-graph-state.js';
import type { DeviceDetail, DeviceSummary, InputPort } from '../../../src/domain/device.js';
import { type RawGraphDevice, validateGraphSpec } from '../../../src/domain/graph-spec.js';

const row = (id: number, name: string): DeviceSummary => ({ id, name, enabled: true });
const detail = (id: number, name: string, inputs: InputPort[] = []): DeviceDetail => ({
  id,
  name,
  type: name,
  enabled: true,
  bypassed: false,
  parameters: [],
  inputs,
  outputs: [{ port: 1, name: 'Primary Output', targets: [] }],
  portTypes: 'unknown',
});
const from = (port: number, device: string): InputPort => ({
  port,
  name: 'Primary Input',
  source: { device, port: 1 },
});

/** A graph port over fixed rows and details that records each `getDevice` reference, and a session on a new project. */
function ports(devices: DeviceSummary[], details: DeviceDetail[]) {
  const reads: string[] = [];
  const graph = {
    listDevices: async () => devices,
    getDevice: async (device: string) => {
      reads.push(device);
      const found = details.find((candidate) => `#${candidate.id}` === device);
      if (found === undefined) throw new Error(`unexpected read of ${device}`);
      return found;
    },
  } as unknown as ProjectGraphReadPort;
  const session = {
    status: () => ({
      executable: null,
      session: { state: 'ready', binding: { kind: 'fresh' }, dirty: false },
    }),
  } as unknown as WorldMachineSessionPort;
  return { reads, graph, session };
}

const spec = (devices: RawGraphDevice[]) => validateGraphSpec({ version: 1, devices });

describe('readGraphState (spec v3 section 5, revision 6)', () => {
  it('reads no second phase when every current source name is unique', async () => {
    const p = ports(
      [row(1, 'Base'), row(2, 'Eroded')],
      [detail(1, 'Base'), detail(2, 'Eroded', [from(1, 'Base')])],
    );
    const state = await readGraphState(spec([{ name: 'Eroded', type: 'Eroded' }]), p.graph, p.session);
    expect(p.reads).toEqual(['#2']);
    expect(state.details.map((device) => device.id)).toEqual([2]);
  });

  it('then reads each unread device that shares a current source name, once, after the first phase', async () => {
    const eroded = detail(3, 'Eroded', [from(1, 'Combiner'), from(2, 'Combiner')]);
    const p = ports(
      [row(1, 'Combiner'), row(2, 'Combiner'), row(3, 'Eroded')],
      [detail(1, 'Combiner'), detail(2, 'Combiner'), eroded],
    );
    const state = await readGraphState(
      spec([
        { name: 'Eroded', type: 'Eroded' },
        { name: 'second', id: 2, type: 'Combiner' },
      ]),
      p.graph,
      p.session,
    );
    expect(p.reads).toEqual(['#3', '#2', '#1']);
    expect(state.details.map((device) => device.id)).toEqual([3, 2, 1]);
    expect(state.projectPath).toBeNull();
  });
});
