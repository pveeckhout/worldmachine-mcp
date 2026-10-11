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
});
