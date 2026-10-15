import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FsGraphTemplateLoader,
  MAX_TEMPLATE_BYTES,
} from '../../../../src/adapter/out/fs/graph-template-loader.js';
import { FsPathPolicy } from '../../../../src/adapter/out/fs/path-policy.js';
import { WorldMachineError } from '../../../../src/domain/errors.js';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'templates-')));
const loader = new FsGraphTemplateLoader(new FsPathPolicy([root]));
const write = (name: string, content: string): string => {
  const path = join(root, name);
  writeFileSync(path, content);
  return path;
};
async function refusal(action: Promise<unknown>): Promise<string> {
  try {
    await action;
  } catch (error) {
    if (error instanceof WorldMachineError && error.code === 'REFUSED') return error.message;
    throw error;
  }
  throw new Error('the loader accepted the file');
}

describe('FsGraphTemplateLoader (templates design sections 4 and 5)', () => {
  it('loads and fills a template', async () => {
    const path = write(
      'ramp.json',
      JSON.stringify({
        template: 1,
        parameters: { width: { type: 'number', default: 0.5 } },
        spec: {
          version: 1,
          devices: [{ name: 'Ramp', type: 'Gradient', parameters: { Width: { $param: 'width' } } }],
        },
      }),
    );
    expect(await loader.load(path, { width: 0.25 })).toEqual({
      version: 1,
      devices: [{ name: 'Ramp', type: 'Gradient', parameters: { Width: 0.25 } }],
    });
  });

  it('refuses a file over 1 MB', async () => {
    const path = write('big.json', `{"version":1,"devices":[],"x":"${'a'.repeat(MAX_TEMPLATE_BYTES)}"}`);
    expect(await refusal(loader.load(path, {}))).toBe(`${path}: the file is larger than 1 MB`);
  });

  it('refuses invalid JSON', async () => {
    const path = write('broken.json', '{ "version": 1, ');
    expect(await refusal(loader.load(path, {}))).toMatch(new RegExp(`^${path}: not valid JSON \\(`));
  });

  it('refuses a filled spec that fails the structure check', async () => {
    const path = write('shape.json', JSON.stringify({ version: 1, devices: [{ name: 'Ramp' }] }));
    expect(await refusal(loader.load(path, {}))).toMatch(
      new RegExp(`^${path}: the filled spec is not a graph spec \\(`),
    );
  });

  it('refuses a path the policy refuses', async () => {
    expect(await refusal(loader.load('relative.json', {}))).toBe(
      'Template paths must be absolute: relative.json',
    );
  });
});
