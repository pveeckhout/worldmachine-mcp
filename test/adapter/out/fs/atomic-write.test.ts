import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    fsyncSync: (fd: number) => {
      calls.push('fsync');
      actual.fsyncSync(fd);
    },
    renameSync: (from: string, to: string) => {
      calls.push('rename');
      actual.renameSync(from, to);
    },
  };
});

const { writeFileAtomic } = await import('../../../../src/adapter/out/fs/atomic-write.js');

describe('writeFileAtomic', () => {
  it('syncs the temp file before the rename and leaves only the target', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wm-atomic-'));
    calls.length = 0;
    writeFileAtomic(join(dir, 'a.json'), 'text');
    expect(calls).toEqual(['fsync', 'rename']);
    expect(readFileSync(join(dir, 'a.json'), 'utf8')).toBe('text');
    expect(readdirSync(dir)).toEqual(['a.json']);
  });
});
