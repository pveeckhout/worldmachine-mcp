import { describe, expect, it } from 'vitest';
import { currentWiring } from '../../src/domain/current-wiring.js';
import type {
  DeviceDetail,
  DeviceSummary,
  InputPort,
  OutputPort,
  PortLink,
} from '../../src/domain/device.js';

const row = (id: number, name: string): DeviceSummary => ({ id, name, enabled: true });
const fed = (port: number, device: string, sourcePort = 1): InputPort => ({
  port,
  name: 'Primary Input',
  source: { device, port: sourcePort },
});
/** Output ports 1, 2, … with the given targets. */
const outputs = (...ports: PortLink[][]): OutputPort[] =>
  ports.map((targets, index) => ({ port: index + 1, name: `Output ${index + 1}`, targets }));
const detail = (id: number, name: string, read: OutputPort[]): DeviceDetail => ({
  id,
  name,
  type: 'Erosion',
  enabled: true,
  bypassed: false,
  parameters: [],
  inputs: [],
  outputs: read,
  portTypes: 'catalogued',
});

describe('currentWiring (fact 82)', () => {
  it('gives the outputs of a read device and undefined for an unread one', () => {
    const read = outputs([{ device: 'Erosion', port: 1 }]);
    const wiring = currentWiring({
      devices: [row(1, 'Base'), row(2, 'Erosion')],
      details: [detail(1, 'Base', read)],
    });
    expect(wiring.outputsOf(1)).toBe(read);
    expect(wiring.outputsOf(2)).toBeUndefined();
  });

  it('finds the one listed device of the source name without reading it', () => {
    const wiring = currentWiring({ devices: [row(1, 'Base'), row(2, 'Erosion')], details: [] });
    expect(wiring.readable(fed(1, 'Base'))).toBe(false);
    expect(wiring.current('Erosion', fed(1, 'Base', 2))).toEqual({ kind: 'found', id: 1, port: 2 });
  });

  it('resolves a shared source name through the output targets', () => {
    const devices = [row(1, 'Combiner'), row(2, 'Combiner'), row(3, 'Erosion')];
    const wiring = currentWiring({
      devices,
      details: [
        detail(1, 'Combiner', outputs([{ device: 'Thermal Weathering', port: 1 }])),
        detail(2, 'Combiner', outputs([{ device: 'Erosion', port: 1 }])),
      ],
    });
    expect(wiring.readable(fed(1, 'Combiner'))).toBe(true);
    expect(wiring.current('Erosion', fed(1, 'Combiner'))).toEqual({ kind: 'found', id: 2, port: 1 });
  });

  it('is not readable while a candidate of the source name is unread', () => {
    const wiring = currentWiring({
      devices: [row(1, 'Combiner'), row(2, 'Combiner'), row(3, 'Erosion')],
      details: [detail(1, 'Combiner', outputs([{ device: 'Erosion', port: 1 }]))],
    });
    expect(wiring.readable(fed(1, 'Combiner'))).toBe(false);
  });

  it('is readable for an input without a wire', () => {
    const wiring = currentWiring({ devices: [row(1, 'Base')], details: [] });
    expect(wiring.readable({ port: 1, name: 'Primary Input' })).toBe(true);
  });
});
