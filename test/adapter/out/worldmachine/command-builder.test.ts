import { describe, expect, it } from 'vitest';
import {
  buildCommand,
  sentinel,
  sentinelEcho,
} from '../../../../src/adapter/out/worldmachine/command-builder.js';
import { WorldMachineError } from '../../../../src/domain/errors.js';

function refused(action: () => unknown): WorldMachineError {
  try {
    action();
  } catch (error) {
    if (error instanceof WorldMachineError && error.code === 'REFUSED') return error;
    throw error;
  }
  throw new Error('expected REFUSED');
}

describe('buildCommand', () => {
  it('joins words and an optional tail that may contain spaces', () => {
    expect(buildCommand(['device', 'list'])).toBe('device list');
    expect(buildCommand(['param', 'list'], 'Height Output')).toBe('param list Height Output');
  });

  it.each([
    ['newline in a tail', ['device', 'list'], 'x\nproject close force'],
    ['carriage return', ['device', 'list'], 'x\r'],
    ['NUL', ['device', 'list'], 'x\u0000'],
    ['DEL', ['device', 'list'], 'x\u007f'],
    ['tab', ['device', 'list'], 'a\tb'],
    ['sentinel prefix', ['device', 'list'], '__end_abc_0'],
    ['blank tail', ['device', 'list'], '   '],
    ['padded tail', ['device', 'list'], ' x'],
    ['double quote', ['device', 'list'], 'Grad "A"'],
    ['single quote', ['device', 'list'], "Grad 'A'"],
    ['backslash', ['device', 'list'], 'Grad\\A'],
  ])('refuses a %s', (_label, words, tail) => {
    refused(() => buildCommand(words, tail));
  });

  it.each([
    ['a word with a space', ['device', 'list x']],
    ['an empty word', ['device', '']],
    ['a control character', ['dev\nice']],
  ])('refuses %s', (_label, words) => {
    refused(() => buildCommand(words));
  });
});

describe('sentinels', () => {
  it('builds the sentinel command and the error line World Machine echoes for it', () => {
    expect(sentinel('ab12', 3)).toBe('__end_ab12_3');
    expect(sentinelEcho('ab12', 3)).toBe("Error: Unknown command: '__end_ab12_3'");
  });

  it('keeps index 1 and index 10 distinguishable', () => {
    expect(sentinelEcho('ab12', 10).startsWith(sentinelEcho('ab12', 1))).toBe(false);
  });
});
