import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../../scripts/check-fixtures.mjs', import.meta.url));

function check(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'fixtures-'));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });
}

describe('check-fixtures', () => {
  it('passes clean fixtures', () => {
    expect(check({ 'a.txt': 'Devices (0 total):\n  Doc Path: <HOME>/Documents\n' }).status).toBe(0);
  });

  it.each([
    ['/home/alice/x', 'a Linux home path'],
    ['/Users/alice/x', 'a macOS home path'],
    ['C:\\Users\\alice\\x', 'a Windows home path'],
    ['License Manager.Checkout: ok', 'a licence line'],
  ])('fails on %s (%s)', (line) => {
    const result = check({ 'bad.txt': `fine\n${line}\n` });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('bad.txt:2');
  });
});
