import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FsPathPolicy } from '../../../../src/adapter/out/fs/path-policy.js';
import type { WorldMachineError } from '../../../../src/domain/errors.js';

const base = realpathSync(mkdtempSync(join(tmpdir(), 'policy-')));
const root = join(base, 'root');
const outside = join(base, 'outside');
mkdirSync(join(root, 'nested'), { recursive: true });
mkdirSync(outside);
writeFileSync(join(root, 'nested', 'world.tmd'), '');
writeFileSync(join(root, 'notes.txt'), '');
mkdirSync(join(root, 'folder.tmd'));
writeFileSync(join(outside, 'secret.tmd'), '');
writeFileSync(join(outside, 'notes.txt'), '');
symlinkSync(join(outside, 'secret.tmd'), join(root, 'link.tmd'));
symlinkSync(outside, join(root, 'escape'));
symlinkSync(root, join(base, 'root-link'));

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as WorldMachineError).code;
  }
  return 'resolved';
}

async function messageOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as WorldMachineError).message;
  }
  return 'resolved';
}

describe('FsPathPolicy.authorizeExistingProject', () => {
  const policy = new FsPathPolicy([root]);

  it('returns the canonical path of a .tmd inside a root', async () => {
    expect(await policy.authorizeExistingProject(join(root, 'nested', '..', 'nested', 'world.tmd'))).toBe(
      join(root, 'nested', 'world.tmd'),
    );
  });

  it('accepts files when the root itself is given through a symlink', async () => {
    const linked = new FsPathPolicy([join(base, 'root-link')]);
    expect(await linked.authorizeExistingProject(join(root, 'nested', 'world.tmd'))).toBe(
      join(root, 'nested', 'world.tmd'),
    );
  });

  it.each([
    ['outside every root', () => join(outside, 'secret.tmd')],
    ['a symlinked file that points outside', () => join(root, 'link.tmd')],
    ['a path through a symlinked directory that points outside', () => join(root, 'escape', 'secret.tmd')],
    ['a non-.tmd file', () => join(root, 'notes.txt')],
    ['a directory named like a project', () => join(root, 'folder.tmd')],
    ['a missing file', () => join(root, 'missing.tmd')],
    ['a relative path', () => 'nested/world.tmd'],
    ['the root itself', () => root],
  ])('refuses %s', async (_label, input) => {
    expect(await codeOf(policy.authorizeExistingProject(input()))).toBe('REFUSED');
  });

  it('reports NOT_CONFIGURED when none of the configured roots exist', async () => {
    expect(
      await codeOf(
        new FsPathPolicy([join(base, 'gone')]).authorizeExistingProject(join(root, 'nested', 'world.tmd')),
      ),
    ).toBe('NOT_CONFIGURED');
  });

  it('reports NOT_CONFIGURED when there are no allowed roots', async () => {
    expect(
      await codeOf(new FsPathPolicy(null).authorizeExistingProject(join(root, 'nested', 'world.tmd'))),
    ).toBe('NOT_CONFIGURED');
  });

  it('refuses a sibling directory with a similar name', async () => {
    mkdirSync(join(base, 'root-other'), { recursive: true });
    writeFileSync(join(base, 'root-other', 'x.tmd'), '');
    expect(await codeOf(policy.authorizeExistingProject(join(base, 'root-other', 'x.tmd')))).toBe('REFUSED');
  });

  it('accepts uppercase extension inside a root', async () => {
    writeFileSync(join(root, 'World.TMD'), '');
    expect(await policy.authorizeExistingProject(join(root, 'World.TMD'))).toBe(join(root, 'World.TMD'));
  });

  it('produces identical refusal messages for all outside-root cases', async () => {
    const missingOutside = join(outside, 'missing.tmd');
    const nonTmdOutside = join(outside, 'notes.txt');
    const tmdOutside = join(outside, 'secret.tmd');

    const missingMsg = await messageOf(policy.authorizeExistingProject(missingOutside));
    const nonTmdMsg = await messageOf(policy.authorizeExistingProject(nonTmdOutside));
    const tmdMsg = await messageOf(policy.authorizeExistingProject(tmdOutside));

    // Normalize messages by replacing paths with placeholders
    const normalize = (msg: string, path: string) => msg.replace(path, '<p>');
    const normalizedMissing = normalize(missingMsg, missingOutside);
    const normalizedNonTmd = normalize(nonTmdMsg, nonTmdOutside);
    const normalizedTmd = normalize(tmdMsg, tmdOutside);

    // All three must produce identical messages after normalization
    expect(normalizedMissing).toBe(normalizedNonTmd);
    expect(normalizedNonTmd).toBe(normalizedTmd);

    // All must have REFUSED code
    expect(await codeOf(policy.authorizeExistingProject(missingOutside))).toBe('REFUSED');
    expect(await codeOf(policy.authorizeExistingProject(nonTmdOutside))).toBe('REFUSED');
    expect(await codeOf(policy.authorizeExistingProject(tmdOutside))).toBe('REFUSED');
  });
});
