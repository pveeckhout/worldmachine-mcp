import { describe, expect, it } from 'vitest';
import type { DeviceDetail } from '../../src/domain/device.js';
import { graphDiff } from '../../src/domain/graph-diff.js';
import type { PlanStep } from '../../src/domain/graph-plan.js';

function detail(id: number, name: string, type: string, extra: Partial<DeviceDetail> = {}): DeviceDetail {
  return {
    id,
    name,
    type,
    enabled: true,
    bypassed: false,
    parameters: [],
    inputs: [],
    outputs: [],
    portTypes: 'unknown',
    ...extra,
  };
}
const input = (port: number, device?: string) => ({
  port,
  name: 'Primary Input',
  ...(device === undefined ? {} : { source: { device, port: 1 } }),
});

const STEPS: PlanStep[] = [
  {
    op: 'disconnect',
    device: 'Eroded',
    id: 20,
    port: 1,
    from: 'Old.1',
    source: { device: 'Old', id: 12, port: 1 },
  },
  { op: 'remove', device: 'Old', id: 12, wiresRemoved: [] },
  { op: 'add', device: 'Base', type: 'Advanced Perlin' },
  { op: 'set-parameter', device: 'Base', name: 'scale', to: '0.5', comparable: false },
  { op: 'set-enabled', device: 'Eroded', id: 20, from: true, to: false },
  { op: 'set-bypassed', device: 'Eroded', id: 20, from: false, to: true },
  { op: 'set-bypassed', device: 'Base', to: true },
  { op: 'set-parameter', device: 'Eroded', id: 20, name: 'steps', from: '4', to: '6', comparable: true },
  {
    op: 'set-parameter',
    device: 'Eroded',
    id: 20,
    name: 'scale',
    from: '8 km',
    to: '0.5',
    comparable: false,
  },
  { op: 'connect', device: 'Eroded', id: 20, port: 1, from: 'Base.1', source: { device: 'Base', port: 1 } },
];

describe('graphDiff (spec v3 section 6)', () => {
  it('reports added, removed, and changed devices in the order of their first step', () => {
    const before = [
      detail(12, 'Old', 'Perlin Noise'),
      detail(20, 'Eroded', 'Erosion', {
        parameters: [
          { name: 'steps', type: 'int', value: '4' },
          { name: 'scale', type: 'float', value: '4 km' },
        ],
        inputs: [input(1, 'Old'), input(2)],
      }),
    ];
    const after = [
      detail(536, 'Base', 'Advanced Perlin', {
        bypassed: true,
        parameters: [{ name: 'scale', type: 'float', value: '4 km' }],
      }),
      detail(20, 'Eroded', 'Erosion', {
        enabled: false,
        bypassed: true,
        parameters: [
          { name: 'steps', type: 'int', value: '6' },
          { name: 'scale', type: 'float', value: '4 km' },
        ],
        inputs: [input(1, 'Base'), input(2)],
      }),
    ];
    expect(graphDiff(STEPS, { before, after, addedIds: new Map([['base', 536]]) })).toEqual([
      {
        device: 'Eroded',
        change: 'changed',
        id: 20,
        enabled: { before: true, after: false },
        bypassed: { before: false, after: true },
        parameters: { steps: { before: '4', after: '6' } },
        inputs: { '1': { before: 'Old.1', after: 'Base.1' } },
      },
      { device: 'Old', change: 'removed', before: { id: 12, type: 'Perlin Noise' } },
      {
        device: 'Base',
        change: 'added',
        after: {
          id: 536,
          type: 'Advanced Perlin',
          enabled: true,
          bypassed: true,
          parameters: { scale: '4 km' },
          inputs: {},
        },
      },
    ]);
  });

  it('reports bypass on a changed device only when it changed', () => {
    const before = detail(20, 'Eroded', 'Erosion', { bypassed: true });
    const after = detail(20, 'Eroded', 'Erosion', { enabled: false, bypassed: true });
    const steps: PlanStep[] = [{ op: 'set-enabled', device: 'Eroded', id: 20, from: true, to: false }];
    expect(graphDiff(steps, { before: [before], after: [after], addedIds: new Map() })).toEqual([
      { device: 'Eroded', change: 'changed', id: 20, enabled: { before: true, after: false } },
    ]);
  });

  it('leaves out a device whose read-back shows no change, such as a float set to its value', () => {
    const eroded = detail(20, 'Eroded', 'Erosion', {
      parameters: [{ name: 'scale', type: 'float', value: '4 km' }],
    });
    const steps: PlanStep[] = [
      {
        op: 'set-parameter',
        device: 'Eroded',
        id: 20,
        name: 'scale',
        from: '4 km',
        to: '0.5',
        comparable: false,
      },
    ];
    expect(graphDiff(steps, { before: [eroded], after: [eroded], addedIds: new Map() })).toEqual([]);
  });

  it('reports the input a remove cut on a managed device, after the devices the steps name', () => {
    const old = detail(12, 'Old', 'Perlin Noise');
    const was = detail(20, 'Eroded', 'Erosion', { inputs: [input(1, 'Old'), input(2, 'Old')] });
    const is = detail(20, 'Eroded', 'Erosion', { inputs: [input(1), input(2)] });
    const steps: PlanStep[] = [{ op: 'remove', device: 'Old', id: 12, wiresRemoved: [] }];
    const cutInputs = [
      { device: 'Eroded', id: 20, port: 1 },
      { device: 'Eroded', id: 20, port: 2 },
      { device: 'Eroded', id: 20, port: 1 },
    ];
    expect(graphDiff(steps, { before: [old, was], after: [is], addedIds: new Map(), cutInputs })).toEqual([
      { device: 'Old', change: 'removed', before: { id: 12, type: 'Perlin Noise' } },
      {
        device: 'Eroded',
        change: 'changed',
        id: 20,
        inputs: { '1': { before: 'Old.1', after: null }, '2': { before: 'Old.1', after: null } },
      },
    ]);
  });

  it('merges a cut input into the entry of a device a step names', () => {
    const old = detail(12, 'Old', 'Perlin Noise');
    const was = detail(20, 'Eroded', 'Erosion', { inputs: [input(1, 'Old')] });
    const is = detail(20, 'Eroded', 'Erosion', { enabled: false, inputs: [input(1)] });
    const steps: PlanStep[] = [
      { op: 'remove', device: 'Old', id: 12, wiresRemoved: [] },
      { op: 'set-enabled', device: 'Eroded', id: 20, from: true, to: false },
    ];
    const cutInputs = [{ device: 'Eroded', id: 20, port: 1 }];
    expect(graphDiff(steps, { before: [old, was], after: [is], addedIds: new Map(), cutInputs })).toEqual([
      { device: 'Old', change: 'removed', before: { id: 12, type: 'Perlin Noise' } },
      {
        device: 'Eroded',
        change: 'changed',
        id: 20,
        enabled: { before: true, after: false },
        inputs: { '1': { before: 'Old.1', after: null } },
      },
    ]);
  });

  it('reports two removed devices that share a name, each by its id', () => {
    const steps: PlanStep[] = [
      { op: 'remove', device: 'Twin', id: 12, wiresRemoved: [] },
      { op: 'remove', device: 'Twin', id: 13, wiresRemoved: [] },
    ];
    const before = [detail(12, 'Twin', 'Perlin Noise'), detail(13, 'Twin', 'Gradient')];
    expect(graphDiff(steps, { before, after: [], addedIds: new Map() })).toEqual([
      { device: 'Twin', change: 'removed', before: { id: 12, type: 'Perlin Noise' } },
      { device: 'Twin', change: 'removed', before: { id: 13, type: 'Gradient' } },
    ]);
  });

  it('reports a disconnect with no connect as an input changed to null', () => {
    const steps: PlanStep[] = [
      {
        op: 'disconnect',
        device: 'Eroded',
        id: 20,
        port: 1,
        from: 'Old.1',
        source: { device: 'Old', id: 12, port: 1 },
      },
    ];
    const was = detail(20, 'Eroded', 'Erosion', { inputs: [input(1, 'Old')] });
    const is = detail(20, 'Eroded', 'Erosion', { inputs: [input(1)] });
    expect(graphDiff(steps, { before: [was], after: [is], addedIds: new Map() })).toEqual([
      { device: 'Eroded', change: 'changed', id: 20, inputs: { '1': { before: 'Old.1', after: null } } },
    ]);
  });

  describe('a missing id or detail throws', () => {
    const connect: PlanStep = {
      op: 'connect',
      device: 'Eroded',
      id: 20,
      port: 1,
      from: 'Base.1',
      source: { device: 'Base', port: 1 },
    };

    it('names a removed device that is not in the state from before', () => {
      const steps: PlanStep[] = [{ op: 'remove', device: 'Old', id: 12, wiresRemoved: [] }];
      expect(() => graphDiff(steps, { before: [], after: [], addedIds: new Map() })).toThrow(
        "graphDiff: removed device 'Old' (#12) is not in the state from before",
      );
    });

    it('names an added device with no recorded id', () => {
      const steps: PlanStep[] = [{ op: 'add', device: 'Base', type: 'Advanced Perlin' }];
      expect(() => graphDiff(steps, { before: [], after: [], addedIds: new Map() })).toThrow(
        "graphDiff: added device 'Base' has no recorded id",
      );
    });

    it('names an added device that was not read back', () => {
      const steps: PlanStep[] = [{ op: 'add', device: 'Base', type: 'Advanced Perlin' }];
      expect(() => graphDiff(steps, { before: [], after: [], addedIds: new Map([['base', 536]]) })).toThrow(
        "graphDiff: added device 'Base' (#536) was not read back",
      );
    });

    it('names a changed device with no id', () => {
      const steps: PlanStep[] = [{ ...connect, id: undefined } as unknown as PlanStep];
      expect(() => graphDiff(steps, { before: [], after: [], addedIds: new Map() })).toThrow(
        "graphDiff: changed device 'Eroded' has no id",
      );
    });

    it('names a changed device missing from the state from before', () => {
      const is = detail(20, 'Eroded', 'Erosion');
      expect(() => graphDiff([connect], { before: [], after: [is], addedIds: new Map() })).toThrow(
        "graphDiff: changed device 'Eroded' (#20) is not in the state from before",
      );
    });

    it('names a changed device that was not read back', () => {
      const was = detail(20, 'Eroded', 'Erosion');
      expect(() => graphDiff([connect], { before: [was], after: [], addedIds: new Map() })).toThrow(
        "graphDiff: changed device 'Eroded' (#20) was not read back",
      );
    });
  });
});
