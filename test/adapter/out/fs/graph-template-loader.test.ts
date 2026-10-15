import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FsGraphTemplateLoader,
  MAX_TEMPLATE_BYTES,
} from '../../../../src/adapter/out/fs/graph-template-loader.js';
import { FsPathPolicy } from '../../../../src/adapter/out/fs/path-policy.js';
import type { PathPolicyPort } from '../../../../src/application/port/out/path-policy-port.js';
import { WorldMachineError } from '../../../../src/domain/errors.js';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'templates-')));
const loader = new FsGraphTemplateLoader(new FsPathPolicy([root]));
const write = (name: string, content: string | Uint8Array): string => {
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

  it('accepts a file of exactly 1 MB', async () => {
    const json = '{"version":1,"devices":[]}';
    const path = write('exact.json', json + ' '.repeat(MAX_TEMPLATE_BYTES - json.length));
    expect(await loader.load(path, {})).toEqual({ version: 1, devices: [] });
  });

  it('refuses a file one byte over 1 MB', async () => {
    const json = '{"version":1,"devices":[]}';
    const path = write('over.json', json + ' '.repeat(MAX_TEMPLATE_BYTES + 1 - json.length));
    expect(await refusal(loader.load(path, {}))).toBe(`${path}: the file is larger than 1 MB`);
  });

  it('loads a template that starts with a UTF-8 byte order mark', async () => {
    const path = write(
      'bom.json',
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"version":1,"devices":[]}')]),
    );
    expect(await loader.load(path, {})).toEqual({ version: 1, devices: [] });
  });

  it('refuses a file that is not valid UTF-8', async () => {
    const path = write(
      'latin.json',
      Buffer.concat([
        Buffer.from('{"version":1,"devices":[{"name":"'),
        Buffer.from([0xff]),
        Buffer.from('","type":"Gradient"}]}'),
      ]),
    );
    expect(await refusal(loader.load(path, {}))).toBe(`${path}: not valid UTF-8`);
  });

  it('refuses a path that is not a regular file when opened', async () => {
    // The policy checks the file before open; a stub stands in for a directory swapped in after that check.
    const directory = join(root, 'swapped.json');
    mkdirSync(directory);
    const policy = { authorizeExistingTemplate: async () => directory } as unknown as PathPolicyPort;
    expect(await refusal(new FsGraphTemplateLoader(policy).load(directory, {}))).toBe(
      `${directory}: not a regular file`,
    );
  });

  it.skipIf(process.platform === 'win32')(
    'refuses a FIFO swapped in after the policy check without waiting for a writer',
    async () => {
      // Without a non-blocking open, opening a FIFO waits for a writer; the short timeout makes that visible.
      const fifo = join(root, 'fifo.json');
      execFileSync('mkfifo', [fifo]);
      const policy = { authorizeExistingTemplate: async () => fifo } as unknown as PathPolicyPort;
      expect(await refusal(new FsGraphTemplateLoader(policy).load(fifo, {}))).toBe(
        `${fifo}: not a regular file`,
      );
    },
    2000,
  );

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
