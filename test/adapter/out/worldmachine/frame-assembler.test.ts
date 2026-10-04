import { describe, expect, it } from 'vitest';
import { FrameAssembler } from '../../../../src/adapter/out/worldmachine/frame-assembler.js';

const echo = (id: string, i: number) =>
  `Error: Unknown command: '__end_${id}_${i}'. Type 'help' for a list of commands.`;

describe('FrameAssembler', () => {
  it('splits output per command at each sentinel echo and trims surrounding blank lines', () => {
    const assembler = new FrameAssembler('b1', ['system info', 'device list']);
    for (const line of [
      'World Machine System Info:',
      '  Version:  Build 4067',
      '',
      echo('b1', 0),
      'Devices (0 total):',
      '',
    ]) {
      expect(assembler.push(line)).toBe(false);
    }
    expect(assembler.push(echo('b1', 1))).toBe(true);
    expect(assembler.responses).toEqual([
      {
        command: 'system info',
        output: ['World Machine System Info:', '  Version:  Build 4067'],
        errors: [],
      },
      { command: 'device list', output: ['Devices (0 total):'], errors: [] },
    ]);
  });

  it('attributes error lines to the command they follow, keeping the full text', () => {
    const assembler = new FrameAssembler('b2', ['bogus', 'system info']);
    assembler.push("Error: Unknown command: 'bogus'. Type 'help' for a list of commands.");
    assembler.push(echo('b2', 0));
    assembler.push('World Machine System Info:');
    assembler.push(echo('b2', 1));
    expect(assembler.responses[0]?.errors).toEqual([
      "Error: Unknown command: 'bogus'. Type 'help' for a list of commands.",
    ]);
    expect(assembler.responses[1]?.errors).toEqual([]);
  });

  it('ignores sentinel echoes that belong to another batch', () => {
    const assembler = new FrameAssembler('b3', ['device list']);
    assembler.push(echo('old', 0));
    assembler.push('Devices (0 total):');
    expect(assembler.push(echo('b3', 0))).toBe(true);
    expect(assembler.responses[0]).toEqual({
      command: 'device list',
      output: ['Devices (0 total):'],
      errors: [],
    });
  });

  it('does not close frame 1 on the echo for frame 10', () => {
    const commands = Array.from({ length: 11 }, (_, i) => `c${i}`);
    const assembler = new FrameAssembler('b4', commands);
    assembler.push(echo('b4', 0));
    assembler.push(echo('b4', 10));
    expect(assembler.responses).toHaveLength(1);
  });

  it('reports done immediately for an empty batch', () => {
    expect(new FrameAssembler('b5', []).done).toBe(true);
  });
});
