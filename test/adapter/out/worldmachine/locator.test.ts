import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveExecutable } from '../../../../src/adapter/out/worldmachine/locator.js';

const dir = mkdtempSync(join(tmpdir(), 'locator-'));
const executable = join(dir, 'wm');
writeFileSync(executable, '#!/bin/sh\n');
chmodSync(executable, 0o755);
const plain = join(dir, 'plain');
writeFileSync(plain, '');
chmodSync(plain, 0o644);

describe('resolveExecutable', () => {
  it('returns the absolute path of an executable file', () => {
    expect(resolveExecutable(executable)).toBe(executable);
  });

  it.each([
    ['unset', null],
    ['missing', join(dir, 'missing')],
    ['not executable', plain],
    ['a directory', dir],
  ])('returns null when %s', (_label, value) => {
    expect(resolveExecutable(value)).toBeNull();
  });
});
