import { describe, expect, it } from 'vitest';
import type { DeviceSummary, InputPort, OutputPort, PortLink } from '../../src/domain/device.js';
import { resolveWireSource, sourceCandidates } from '../../src/domain/wire-source.js';

const row = (id: number, name: string): DeviceSummary => ({ id, name, enabled: true });
const fed = (port: number, device: string, sourcePort = 1): InputPort => ({
  port,
  name: 'Primary Input',
  source: { device, port: sourcePort },
});
/** Output ports 1, 2, … with the given targets. */
const outputs = (...ports: PortLink[][]): OutputPort[] =>
  ports.map((targets, index) => ({ port: index + 1, name: `Output ${index + 1}`, targets }));
const reader =
  (table: Record<number, OutputPort[]>) =>
  (id: number): readonly OutputPort[] | undefined =>
    table[id];

describe('resolveWireSource (spec v3 section 5, revision 6, fact 82)', () => {
  it('reports none for an input without a wire', () => {
    expect(
      resolveWireSource('Erosion', { port: 1, name: 'Primary Input' }, [row(1, 'Base')], reader({})),
    ).toEqual({ kind: 'none' });
  });

  it('takes the one listed device of the shown name without reading its outputs', () => {
    expect(
      resolveWireSource('Erosion', fed(1, 'Base', 2), [row(1, 'Base'), row(2, 'Erosion')], reader({})),
    ).toEqual({ kind: 'found', id: 1, port: 2 });
  });

  it('picks the one candidate whose output lists the destination and input port', () => {
    const devices = [row(1, 'Combiner'), row(2, 'Combiner'), row(3, 'Erosion')];
    const read = reader({
      1: outputs([{ device: 'Thermal Weathering', port: 1 }]),
      2: outputs([{ device: 'Erosion', port: 1 }]),
    });
    expect(resolveWireSource('Erosion', fed(1, 'Combiner'), devices, read)).toEqual({
      kind: 'found',
      id: 2,
      port: 1,
    });
  });

  it('resolves chained Combiners: base and hills into one, it and the mountains into a second, the second into Erosion', () => {
    const devices = [
      row(1, 'Base'),
      row(2, 'Hills'),
      row(3, 'Combiner'),
      row(4, 'Mountains'),
      row(6, 'Combiner'),
      row(7, 'Erosion'),
    ];
    const read = reader({
      3: outputs([{ device: 'Combiner', port: 1 }]),
      6: outputs([{ device: 'Erosion', port: 1 }]),
    });
    expect(resolveWireSource('Combiner', fed(1, 'Combiner'), devices, read)).toEqual({
      kind: 'found',
      id: 3,
      port: 1,
    });
    expect(resolveWireSource('Erosion', fed(1, 'Combiner'), devices, read)).toEqual({
      kind: 'found',
      id: 6,
      port: 1,
    });
  });

  it('reports ambiguous, with the qualifying ids, for two Combiners each feeding input 1 of another Combiner', () => {
    const devices = [row(3, 'Combiner'), row(4, 'Combiner'), row(5, 'Combiner'), row(6, 'Combiner')];
    const read = reader({
      3: outputs([{ device: 'Combiner', port: 1 }]),
      4: outputs([{ device: 'Combiner', port: 1 }]),
      5: outputs([]),
      6: outputs([]),
    });
    expect(resolveWireSource('Combiner', fed(1, 'Combiner'), devices, read)).toEqual({
      kind: 'ambiguous',
      candidates: [3, 4],
    });
  });

  it('reports unknown when no candidate lists the destination, and when no listed device has the name', () => {
    const devices = [row(1, 'Combiner'), row(2, 'Combiner')];
    expect(
      resolveWireSource('Erosion', fed(1, 'Combiner'), devices, reader({ 1: outputs([]), 2: outputs([]) })),
    ).toEqual({ kind: 'unknown' });
    expect(resolveWireSource('Erosion', fed(1, 'Ghost'), devices, reader({}))).toEqual({ kind: 'unknown' });
  });

  it('compares names as device list lists them, cut at 23 characters (fact 33)', () => {
    const listed = 'ABCDEFGHIJKLMNOPQRSTUVW';
    const devices = [row(1, listed), row(2, listed), row(3, 'Mountain Ridge Erosion')];
    // Assumed: wire list prints whole names; 'Mountain Ridge Erosion 2' lists as 'Mountain Ridge Erosion'.
    const read = reader({ 1: outputs([{ device: 'Mountain Ridge Erosion 2', port: 1 }]), 2: outputs([]) });
    expect(
      resolveWireSource('Mountain Ridge Erosion', fed(1, 'ABCDEFGHIJKLMNOPQRSTUVWX'), devices, read),
    ).toEqual({ kind: 'found', id: 1, port: 1 });
  });

  it('requires the source port and the input port to match', () => {
    const devices = [row(1, 'Combiner'), row(2, 'Combiner')];
    // #1 feeds Erosion input 2, not 1; #2 lists Erosion input 1 on its output 2, not 1.
    const read = reader({
      1: outputs([{ device: 'Erosion', port: 2 }]),
      2: outputs([], [{ device: 'Erosion', port: 1 }]),
    });
    expect(resolveWireSource('Erosion', fed(1, 'Combiner', 1), devices, read)).toEqual({ kind: 'unknown' });
    expect(resolveWireSource('Erosion', fed(1, 'Combiner', 2), devices, read)).toEqual({
      kind: 'found',
      id: 2,
      port: 2,
    });
  });

  it('throws for a candidate whose outputs were not read, as planGraph does without a detail', () => {
    expect(() =>
      resolveWireSource(
        'Erosion',
        fed(1, 'Combiner'),
        [row(1, 'Combiner'), row(2, 'Combiner')],
        reader({ 1: outputs([]) }),
      ),
    ).toThrow('#2');
  });

  it('lists the candidates by exact listed name', () => {
    const devices = [row(1, 'Combiner'), row(2, 'combiner'), row(3, 'Combiner')];
    expect(sourceCandidates(fed(1, 'Combiner'), devices).map((device) => device.id)).toEqual([1, 3]);
    expect(sourceCandidates({ port: 1, name: 'Primary Input' }, devices)).toEqual([]);
  });
});
