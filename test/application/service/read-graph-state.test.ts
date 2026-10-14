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

describe('readGraphState, third phase (unidentifiable-wires design section 3)', () => {
  it('reads the unread devices of a shared predicted source name, after the first two phases', async () => {
    // Combiners with input 1 (raw/p2b-graph-edits.txt l.121-126), so the spec's wires are ones the plan makes.
    const combiners = [10, 11, 12, 20, 21].map((id) =>
      detail(id, 'Combiner', [{ port: 1, name: 'Primary Input' }]),
    );
    const p = ports(
      combiners.map((device) => row(device.id, device.name)),
      combiners,
    );
    const state = await readGraphState(
      spec([
        { name: 'a mix', id: 20, type: 'Combiner', inputs: { '1': '#10' } },
        { name: 'b mix', id: 21, type: 'Combiner', inputs: { '1': '#11' } },
      ]),
      p.graph,
      p.session,
    );
    expect(p.reads).toEqual(['#20', '#21', '#10', '#11', '#12']);
    expect(state.details.map((device) => device.id)).toEqual([20, 21, 10, 11, 12]);
  });

  it('reads nothing more for a spec whose source names are unique', async () => {
    const p = ports(
      [row(1, 'Base'), row(2, 'Eroded'), row(3, 'Other')],
      [detail(1, 'Base'), detail(2, 'Eroded'), detail(3, 'Other')],
    );
    await readGraphState(
      spec([{ name: 'Eroded', type: 'Eroded', inputs: { '1': 'Base' } }]),
      p.graph,
      p.session,
    );
    expect(p.reads).toEqual(['#2', '#1']);
  });

  it('reads no holder of the requested source when the current source is ambiguous (revision 2)', async () => {
    // #40 and #41 are both named Old and both list 'Combiner' input 1, so #20's current source is a conflict.
    const old = (id: number): DeviceDetail => ({
      ...detail(id, 'Old'),
      outputs: [{ port: 1, name: 'Primary Output', targets: [{ device: 'Combiner', port: 1 }] }],
    });
    const fed = detail(20, 'Combiner', [from(1, 'Old')]);
    const p = ports(
      [row(10, 'Combiner'), row(11, 'Combiner'), row(20, 'Combiner'), row(40, 'Old'), row(41, 'Old')],
      [detail(10, 'Combiner'), detail(11, 'Combiner'), fed, old(40), old(41)],
    );
    await readGraphState(
      spec([{ name: 'a mix', id: 20, type: 'Combiner', inputs: { '1': '#10' } }]),
      p.graph,
      p.session,
    );
    expect(p.reads).toEqual(['#20', '#10', '#40', '#41']);
  });
});

describe('readGraphState, fourth phase (wire-loops design section 3)', () => {
  /** `detail` with one input and output 1 listing `targets`. */
  const feeding = (id: number, name: string, targets: string[], input?: string): DeviceDetail => ({
    ...detail(id, name, [input === undefined ? { port: 1, name: 'Primary Input' } : from(1, input)]),
    outputs: [{ port: 1, name: 'Primary Output', targets: targets.map((device) => ({ device, port: 1 })) }],
  });

  it('reads in rounds what the destinations reach downstream and every device of each name', async () => {
    // Hill feeds Ridge, Ridge feeds a Twin (the line names both Twins), Twin #31 feeds Crest, Crest feeds Peak; Far
    // is not reached.
    const p = ports(
      [
        row(1, 'Hill'),
        row(2, 'Ridge'),
        row(30, 'Twin'),
        row(31, 'Twin'),
        row(5, 'Crest'),
        row(3, 'Peak'),
        row(4, 'Far'),
      ],
      [
        feeding(1, 'Hill', ['Ridge']),
        feeding(2, 'Ridge', ['Twin'], 'Hill'),
        feeding(30, 'Twin', [], 'Ridge'),
        feeding(31, 'Twin', ['Crest'], 'Ridge'),
        feeding(5, 'Crest', ['Peak'], 'Twin'),
        feeding(3, 'Peak', [], 'Crest'),
        feeding(4, 'Far', []),
      ],
    );
    const state = await readGraphState(
      spec([{ name: 'Hill', type: 'Hill', inputs: { '1': 'Peak' } }]),
      p.graph,
      p.session,
    );
    expect(p.reads).toEqual(['#1', '#3', '#2', '#30', '#31', '#5']);
    expect(state.details.map((device) => device.id)).toEqual([1, 3, 2, 30, 31, 5]);
  });

  it('reads after the third phase', async () => {
    // Task 3 review Minor 2: Hill is wired from Combiner #20, whose name #21 shares, so the third phase reads #21;
    // Hill feeds Ridge, which the fourth phase reads.
    const combiner = (id: number) => feeding(id, 'Combiner', []);
    const p = ports(
      [row(1, 'Hill'), row(20, 'Combiner'), row(21, 'Combiner'), row(2, 'Ridge')],
      [feeding(1, 'Hill', ['Ridge']), combiner(20), combiner(21), feeding(2, 'Ridge', [], 'Hill')],
    );
    await readGraphState(spec([{ name: 'Hill', type: 'Hill', inputs: { '1': '#20' } }]), p.graph, p.session);
    expect(p.reads).toEqual(['#1', '#20', '#21', '#2']);
  });

  it('reads nothing more for a spec without input wires', async () => {
    const p = ports(
      [row(1, 'Hill'), row(2, 'Ridge')],
      [feeding(1, 'Hill', ['Ridge']), feeding(2, 'Ridge', [])],
    );
    await readGraphState(spec([{ name: 'Hill', type: 'Hill' }]), p.graph, p.session);
    expect(p.reads).toEqual(['#1']);
  });

  it('starts only from the destinations, not from the wire sources', async () => {
    // Hill is wired from Peak; Peak feeds Tail, which is downstream of the source only, so it stays unread.
    const p = ports(
      [row(1, 'Hill'), row(2, 'Ridge'), row(3, 'Peak'), row(7, 'Tail')],
      [
        feeding(1, 'Hill', ['Ridge']),
        feeding(2, 'Ridge', [], 'Hill'),
        feeding(3, 'Peak', ['Tail']),
        feeding(7, 'Tail', [], 'Peak'),
      ],
    );
    await readGraphState(spec([{ name: 'Hill', type: 'Hill', inputs: { '1': 'Peak' } }]), p.graph, p.session);
    expect(p.reads).toEqual(['#1', '#3', '#2']);
  });
});
