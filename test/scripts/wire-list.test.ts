import { describe, expect, it } from 'vitest';
import { readWireList } from '../../scripts/wire-list.mjs';

/**
 * Synthetic wire list lines in the shape of raw/create-water.txt l.122-133: port names are space-padded and each row
 * splits on its arrow. The reader is shared by the port-type catalog parser and the port-type probe.
 */
const header = "Connections for '#4':";
const free = [
  header,
  '  Inputs:',
  '    [1] Height In    <- (none)',
  '    [2] Water In     <- (none)',
  '  Outputs:',
  '    [1] Mixed        -> (none)',
];

describe('readWireList (port-types plan decision D11)', () => {
  it('reads the ports of a well-formed list in printed order', () => {
    expect(readWireList('wire list #4', free)).toEqual({
      inputs: [
        { port: 1, name: 'Height In' },
        { port: 2, name: 'Water In' },
      ],
      outputs: [{ port: 1, name: 'Mixed' }],
    });
  });

  it('reads a section without rows when both headers are printed (v1 fact 21)', () => {
    expect(
      readWireList('wire list #1', [header, '  Inputs:', '  Outputs:', '    [1] Height       -> (none)']),
    ).toEqual({
      inputs: [],
      outputs: [{ port: 1, name: 'Height' }],
    });
  });

  it('fails on an input that is wired', () => {
    const wired = free.map((line) =>
      line.replace('[1] Height In    <- (none)', "[1] Height In    <- 'Height Source' [1]"),
    );
    expect(() => readWireList('wire list #4', wired)).toThrow(
      'wire list #4: input 1 is wired before probing',
    );
  });

  it('fails on a row it cannot read', () => {
    expect(() => readWireList('wire list #4', [...free, 'Something else'])).toThrow(
      "wire list #4: unreadable row 'Something else'",
    );
  });

  it('fails on an unreadable header', () => {
    expect(() => readWireList('wire list #4', ['Something else', ...free.slice(1)])).toThrow(
      'wire list #4: unreadable header',
    );
  });

  it('fails on a list without an Outputs: line', () => {
    expect(() => readWireList('wire list #4', free.slice(0, 4))).toThrow(
      'wire list #4: no Inputs: or Outputs: line',
    );
  });
});
