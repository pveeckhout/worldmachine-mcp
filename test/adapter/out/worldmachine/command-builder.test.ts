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

  it('appends suffix words after the tail', () => {
    expect(buildCommand(['project', 'open'], '/p/a b.tmd', ['force'])).toBe('project open /p/a b.tmd force');
  });

  it('refuses unsafe suffix words', () => {
    refused(() => buildCommand(['project', 'open'], '/p/a.tmd', ['for ce']));
  });

  it.each([
    ['C1 control U+0080', 'x\u0080'],
    ['C1 control U+0085 (next line)', 'x\u0085y'],
    ['C1 control U+009B (CSI)', 'x\u009b'],
    ['C1 control U+009F', 'x\u009f'],
    ['line separator U+2028', 'x\u2028project close force'],
    ['paragraph separator U+2029', 'x\u2029y'],
  ])('refuses a %s in the tail', (_label, tail) => {
    expect(refused(() => buildCommand(['device', 'list'], tail)).message).toBe(
      'Arguments must not contain control characters such as newlines',
    );
  });

  it('refuses a C1 control in a word', () => {
    refused(() => buildCommand(['device\u0085', 'list']));
  });

  it('accepts U+00A0, the first character after the C1 range', () => {
    expect(buildCommand(['device', 'list'], 'a\u00a0b')).toBe('device list a\u00a0b');
  });

  it.each([
    ['a path ending in force', '/r/x force'],
    ['upper-case FORCE', '/r/x FORCE'],
    ['the bare word force', 'force'],
  ])('refuses %s as the tail of project open', (_label, tail) => {
    expect(refused(() => buildCommand(['project', 'open'], tail, ['force'])).message).toBe(
      'The final argument must not end with the word force, which World Machine reads as a flag',
    );
  });

  it('accepts force inside a tail, and at the end of a tail on other commands', () => {
    expect(buildCommand(['project', 'open'], '/r/forced.tmd', ['force'])).toBe(
      'project open /r/forced.tmd force',
    );
    expect(buildCommand(['project', 'open'], '/r/x force.tmd', ['force'])).toBe(
      'project open /r/x force.tmd force',
    );
    expect(buildCommand(['device', 'list'], 'Grad force')).toBe('device list Grad force');
  });

  it('points to #<id> when a tail contains a quote', () => {
    expect(refused(() => buildCommand(['device', 'select'], 'Grad "A"')).message).toBe(
      'Quotes and backslashes are not supported in arguments; refer to devices by #<id>',
    );
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
