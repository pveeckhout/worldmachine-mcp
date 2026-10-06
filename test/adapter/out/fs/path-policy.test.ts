import { execFileSync } from 'node:child_process';
import { linkSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
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
writeFileSync(join(root, '...tmd'), '');
writeFileSync(join(root, '..tmd'), '');
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

describe('FsPathPolicy.authorizeOutputPath (spec v2a section 5)', () => {
  const policy = new FsPathPolicy([root]);

  it('accepts a new file directly in a root and in a subfolder', async () => {
    expect(await policy.authorizeOutputPath(join(root, 'world Height Output-257.png'))).toBe(
      join(root, 'world Height Output-257.png'),
    );
    expect(await policy.authorizeOutputPath(join(root, 'nested', 'tile.png'))).toBe(
      join(root, 'nested', 'tile.png'),
    );
  });

  it('accepts an existing regular file, which World Machine overwrites', async () => {
    expect(await policy.authorizeOutputPath(join(root, 'notes.txt'))).toBe(join(root, 'notes.txt'));
  });

  it('returns the canonical path through a symlinked root', async () => {
    expect(await policy.authorizeOutputPath(join(base, 'root-link', 'x.png'))).toBe(join(root, 'x.png'));
  });

  it.each([
    ['a missing folder', () => join(root, 'no-such-dir', 'x.png'), 'The output folder does not exist'],
    ['a folder that is a file', () => join(root, 'notes.txt', 'x.png'), 'The output folder does not exist'],
    [
      'a folder outside the roots',
      () => join(outside, 'x.png'),
      'The output folder is outside the allowed roots',
    ],
    [
      'a symlinked folder pointing outside',
      () => join(root, 'escape', 'x.png'),
      'The output folder is outside the allowed roots',
    ],
    ['an existing symlink', () => join(root, 'link.tmd'), 'The output path exists and is not a regular file'],
    ['an existing directory', () => join(root, 'nested'), 'The output path exists and is not a regular file'],
    ['a relative path', () => 'x.png', 'Output paths must be absolute'],
  ])('refuses %s', async (_label, input, message) => {
    expect(await codeOf(policy.authorizeOutputPath(input()))).toBe('REFUSED');
    expect(await messageOf(policy.authorizeOutputPath(input()))).toContain(message);
  });

  it('is NOT_CONFIGURED without allowed roots', async () => {
    expect(await codeOf(new FsPathPolicy(null).authorizeOutputPath(join(root, 'x.png')))).toBe(
      'NOT_CONFIGURED',
    );
  });
});

describe('FsPathPolicy.authorizeOutputPath hardening (review round 1)', () => {
  const policy = new FsPathPolicy([root]);
  mkdirSync(join(root, 'a', 'b'), { recursive: true });
  symlinkSync(join(root, 'a', 'b'), join(root, 's'));
  writeFileSync(join(root, 'hard-source.png'), '');
  linkSync(join(root, 'hard-source.png'), join(root, 'hard.png'));
  symlinkSync(join(root, 'no-such-target'), join(root, 'dangling.png'));
  let fifo = false;
  try {
    execFileSync('mkfifo', [join(root, 'pipe.png')]);
    fifo = true;
  } catch {
    // mkfifo unavailable: the FIFO test is skipped below.
  }

  it.each([
    ['a symlink followed by two parent segments', () => `${join(root, 's')}/../../x.png`],
    ['a dot segment', () => `${root}/./x.png`],
    ['repeated slashes', () => `${root}//x.png`],
    ['a trailing slash', () => `${join(root, 'x.png')}/`],
  ])('refuses an unnormalised path: %s', async (_label, input) => {
    expect(await codeOf(policy.authorizeOutputPath(input()))).toBe('REFUSED');
    expect(await messageOf(policy.authorizeOutputPath(input()))).toContain('plain absolute path');
  });

  it('refuses an existing file with several hard links', async () => {
    expect(await codeOf(policy.authorizeOutputPath(join(root, 'hard.png')))).toBe('REFUSED');
    expect(await messageOf(policy.authorizeOutputPath(join(root, 'hard.png')))).toContain('hard links');
  });

  it('refuses a dangling symlink at the final path', async () => {
    expect(await codeOf(policy.authorizeOutputPath(join(root, 'dangling.png')))).toBe('REFUSED');
  });

  it.skipIf(!fifo)('refuses a FIFO at the final path', async () => {
    expect(await codeOf(policy.authorizeOutputPath(join(root, 'pipe.png')))).toBe('REFUSED');
  });

  it('accepts a file under the real folder when the root is configured as a symlink', async () => {
    const linked = new FsPathPolicy([join(base, 'root-link')]);
    expect(await linked.authorizeOutputPath(join(root, 'y.png'))).toBe(join(root, 'y.png'));
  });
});

describe('FsPathPolicy project names that are dot segments (ruling P11-2)', () => {
  const policy = new FsPathPolicy([root]);

  it.each(['...tmd', '..tmd'])('refuses %s as an existing project and as a save target', async (name) => {
    const existing = await messageOf(policy.authorizeExistingProject(join(root, name)));
    expect(existing).toBe(`The project file name ${name} is not allowed.`);
    const save = await messageOf(policy.authorizeSaveTarget(join(root, name)));
    expect(save).toBe(`The project file name ${name} is not allowed.`);
  });
});
