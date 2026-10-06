import { describe, expect, it } from 'vitest';
import { expandTemplate, folderOf, usesTokenInFolder } from '../../src/domain/output-template.js';

const context = { projectFile: '/r/maps/build-test.tmd', resolution: 257 };

describe('expandTemplate (spec v2a section 3)', () => {
  it('expands the default templates as World Machine did (raw/v2-build-export.txt l.15-20, l.86-90)', () => {
    expect(
      expandTemplate({ device: 'Height Output', template: '<project> <name>-<res>.png' }, context),
    ).toEqual({
      kind: 'path',
      path: '/r/maps/build-test Height Output-257.png',
    });
    expect(expandTemplate({ device: 'Splatmap', template: '<project> <name> <res>.png' }, context)).toEqual({
      kind: 'path',
      path: '/r/maps/build-test Splatmap 257.png',
    });
  });

  it('keeps an absolute template absolute and normalises it', () => {
    expect(expandTemplate({ device: 'Height Output', template: '/srv/out/<name>.png' }, context)).toEqual({
      kind: 'path',
      path: '/srv/out/Height Output.png',
    });
  });

  it('joins a relative template with a subfolder to the project folder', () => {
    expect(expandTemplate({ device: 'H', template: 'tiles/<name>.png' }, context)).toEqual({
      kind: 'path',
      path: '/r/maps/tiles/H.png',
    });
  });

  it('refuses an ambiguous target before any other check', () => {
    expect(expandTemplate({ device: 'H', template: '../<name>.png', ambiguous: true }, context)).toEqual({
      kind: 'invalid',
      reason: "the device name or the template contains ' -> ', so the target cannot be read reliably",
    });
  });

  it('refuses a template containing a ".." path segment', () => {
    expect(expandTemplate({ device: 'H', template: '../<name>.png' }, context)).toEqual({
      kind: 'invalid',
      reason: "the template or the device name contains a '..' path segment",
    });
  });

  it('puts a device name containing / into a subfolder, so the folder check must use the full path', () => {
    const expanded = expandTemplate({ device: 'out/H', template: '<project> <name>.png' }, context);
    expect(expanded).toEqual({ kind: 'path', path: '/r/maps/build-test out/H.png' });
    expect(expanded.kind === 'path' && folderOf(expanded.path)).toBe('/r/maps/build-test out');
  });

  it('refuses a template with an unknown token, naming the first one', () => {
    expect(expandTemplate({ device: 'H', template: '<project> <date> <time>.png' }, context)).toEqual({
      kind: 'unknown-token',
      token: '<date>',
    });
  });

  it('does not expand token text or $ patterns inside a device name', () => {
    expect(expandTemplate({ device: '<res> $& $1', template: '<name>.png' }, context)).toEqual({
      kind: 'path',
      path: '/r/maps/<res> $& $1.png',
    });
  });

  it('drops the extension of the project file whatever its case', () => {
    expect(
      expandTemplate(
        { device: 'H', template: '<project>.png' },
        { projectFile: '/r/World.TMD', resolution: 1 },
      ),
    ).toEqual({ kind: 'path', path: '/r/World.png' });
  });

  it('refuses a device name containing a ".." path segment', () => {
    expect(expandTemplate({ device: 'link/../x', template: '<name>.png' }, context)).toEqual({
      kind: 'invalid',
      reason: "the template or the device name contains a '..' path segment",
    });
  });

  it('allows a device name containing ".." as part of a larger component', () => {
    expect(expandTemplate({ device: '..foo', template: '<name>.png' }, context)).toEqual({
      kind: 'path',
      path: '/r/maps/..foo.png',
    });
  });

  it('refuses a device name that is a single dot', () => {
    expect(expandTemplate({ device: '.', template: '<name>.png' }, context)).toEqual({
      kind: 'invalid',
      reason: 'the expanded path has no file name',
    });
  });

  it('refuses a template ending in a slash', () => {
    expect(expandTemplate({ device: 'H', template: 'out/' }, context)).toEqual({
      kind: 'invalid',
      reason: 'the expanded path has no file name',
    });
  });
});

describe('usesTokenInFolder', () => {
  it('finds a token before the last slash only', () => {
    expect(usesTokenInFolder('out-<res>/<name>.png', 'res')).toBe(true);
    expect(usesTokenInFolder('out/<name>-<res>.png', 'res')).toBe(false);
    expect(usesTokenInFolder('<project> <name>-<res>.png', 'res')).toBe(false);
  });
});

describe('expandTemplate: dot segments produced by substitution (ruling P11-2)', () => {
  it('refuses <project> expanding to ".." inside a folder, which the kernel resolves through a symlink', () => {
    expect(
      expandTemplate(
        { device: 'H', template: 'link/<project>/<name>.png' },
        { projectFile: '/R/a/...tmd', resolution: 257 },
      ),
    ).toEqual({ kind: 'invalid', reason: "the expanded path contains a '.' or '..' segment" });
  });

  it('refuses <project> expanding to "."', () => {
    expect(
      expandTemplate(
        { device: 'H', template: 'x/<project>/<name>.png' },
        { projectFile: '/R/a/..tmd', resolution: 257 },
      ),
    ).toEqual({ kind: 'invalid', reason: "the expanded path contains a '.' or '..' segment" });
  });
});
