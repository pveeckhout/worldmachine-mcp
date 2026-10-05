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
symlinkSync(join(outside, 'notes.txt'), join(base, 'file-link'));

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

  it('reports NOT_CONFIGURED when the only configured root is a regular file', async () => {
    expect(
      await codeOf(
        new FsPathPolicy([join(root, 'notes.txt')]).authorizeExistingProject(
          join(root, 'nested', 'world.tmd'),
        ),
      ),
    ).toBe('NOT_CONFIGURED');
  });

  it('reports NOT_CONFIGURED when the only configured root is a symlink to a file', async () => {
    expect(
      await codeOf(
        new FsPathPolicy([join(base, 'file-link')]).authorizeExistingProject(
          join(root, 'nested', 'world.tmd'),
        ),
      ),
    ).toBe('NOT_CONFIGURED');
  });

  it('ignores a file root next to a directory root', async () => {
    const mixed = new FsPathPolicy([join(outside, 'notes.txt'), root]);
    expect(await mixed.authorizeExistingProject(join(root, 'nested', 'world.tmd'))).toBe(
      join(root, 'nested', 'world.tmd'),
    );
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

  it('produces identical refusal messages for outside-root and inside-root refusals', async () => {
    const inputs = [
      join(outside, 'missing.tmd'),
      join(outside, 'notes.txt'),
      join(outside, 'secret.tmd'),
      join(root, 'notes.txt'),
      join(root, 'folder.tmd'),
    ];

    const messages = await Promise.all(
      inputs.map(async (input) =>
        (await messageOf(policy.authorizeExistingProject(input))).replace(input, '<p>'),
      ),
    );

    expect(new Set(messages).size).toBe(1);
    expect(messages[0]).not.toBe('resolved');
    for (const input of inputs) {
      expect(await codeOf(policy.authorizeExistingProject(input))).toBe('REFUSED');
    }
  });
});

describe('FsPathPolicy.authorizeSaveTarget', () => {
  const policy = new FsPathPolicy([root]);

  it('accepts a new file directly in a root and in a subdirectory', async () => {
    expect(await policy.authorizeSaveTarget(join(root, 'new.tmd'))).toEqual({
      path: join(root, 'new.tmd'),
      exists: false,
    });
    expect(await policy.authorizeSaveTarget(join(root, 'nested', 'new.TMD'))).toEqual({
      path: join(root, 'nested', 'new.TMD'),
      exists: false,
    });
  });

  it('reports an existing regular file', async () => {
    expect(await policy.authorizeSaveTarget(join(root, 'nested', 'world.tmd'))).toEqual({
      path: join(root, 'nested', 'world.tmd'),
      exists: true,
    });
  });

  it.each([
    ['a missing directory', () => join(root, 'no-such-dir', 'x.tmd')],
    ['a directory outside the roots', () => join(outside, 'x.tmd')],
    ['a symlinked directory pointing outside', () => join(root, 'escape', 'x.tmd')],
    ['an existing symlink target', () => join(root, 'link.tmd')],
    ['a non-.tmd name', () => join(root, 'x.txt')],
    ['an existing directory with a .tmd name', () => join(root, 'folder.tmd')],
    ['a relative path', () => 'x.tmd'],
  ])('refuses %s', async (_label, input) => {
    expect(await codeOf(policy.authorizeSaveTarget(input()))).toBe('REFUSED');
  });
});
