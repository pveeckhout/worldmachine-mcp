import { describe, expect, it } from 'vitest';
import { parseWireList } from '../../../../../src/adapter/out/worldmachine/parsers/wire-list.js';
import { codeOf, fixtureLines } from './fixture.js';

describe('parseWireList', () => {
  it('reads inputs, outputs, unconnected ports, and continuation rows', () => {
    const wires = parseWireList(fixtureLines('wire-list-erosion.txt'));
    expect(wires.inputs).toEqual([
      { port: 1, name: 'Primary Input', source: { device: 'Flow Restructure', port: 1 } },
      { port: 2, name: 'Water input' },
      { port: 3, name: 'Bedrock Structure Value' },
    ]);
    expect(wires.outputs[0]).toEqual({
      port: 1,
      name: 'Primary Output',
      targets: [{ device: 'Thermal Weathering', port: 1 }],
    });
    expect(wires.outputs[1]).toEqual({
      port: 2,
      name: 'Flow Mask',
      targets: [
        { device: 'Vegetation Layer', port: 2 },
        { device: 'Vegetation Layer', port: 2 },
      ],
    });
    expect(wires.outputs).toHaveLength(5);
  });

  it('reads a device with no inputs and an unconnected output (spec fact 21)', () => {
    expect(
      parseWireList(["Connections for '#1':", '  Inputs:', '  Outputs:', '    [1] Primary Output -> (none)']),
    ).toEqual({ inputs: [], outputs: [{ port: 1, name: 'Primary Output', targets: [] }] });
  });

  it.each([
    [[]],
    [["Connections for 'X':", 'garbage']],
    [["Connections for 'X':", '  Inputs:', "    -> 'A' [1]"]],
    [["Connections for 'X':"]],
    [["Connections for 'X':", '  Inputs:']],
  ])('fails on %j', (lines) => {
    expect(codeOf(() => parseWireList(lines))).toBe('UNEXPECTED_OUTPUT');
  });
});
