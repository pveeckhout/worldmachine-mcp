import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FsPathPolicy } from '../../../../src/adapter/out/fs/path-policy.js';
import { WorldMachineBuilder } from '../../../../src/adapter/out/worldmachine/world-machine-builder.js';
import { WorldMachineExporter } from '../../../../src/adapter/out/worldmachine/world-machine-exporter.js';
import { WorldMachineProcess } from '../../../../src/adapter/out/worldmachine/world-machine-process.js';
import { WorldMachineProjectWriter } from '../../../../src/adapter/out/worldmachine/world-machine-project-writer.js';
import { WorldMachineSession } from '../../../../src/adapter/out/worldmachine/world-machine-session.js';
import { captureLogger, FAKE_WM, fakeEnv } from '../../../support/fake-wm.js';
import { scriptedSession } from '../../../support/scripted-session.js';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'exporter-')));
const sessions: WorldMachineSession[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.shutdown()));
});

function session(extra: Record<string, string> = {}): WorldMachineSession {
  const logger = captureLogger();
  const env = fakeEnv(extra);
  const created = new WorldMachineSession({
    executable: FAKE_WM,
    defaultProject: undefined,
    pathPolicy: new FsPathPolicy([root]),
    commandTimeoutMs: 2_000,
    idleTimeoutMs: 0,
    logger,
    startProcess: (bin, signal, onSpawn) =>
      WorldMachineProcess.start({ bin, readyTimeoutMs: 5_000, logger, env, signal, onSpawn }),
  });
  sessions.push(created);
  return created;
}

describe('WorldMachineExporter (spec v2a section 5)', () => {
  it('lists the export targets', async () => {
    expect(await new WorldMachineExporter(session()).targets()).toEqual([
      { device: 'Height Output', template: '<project> <name>-<res>.png' },
      { device: 'Material Output', template: '<project> <name> <res>.png' },
      { device: 'Colormap only', template: '<project> <name> <res>.png' },
      { device: 'Splatmap', template: '<project> <name> <res>.png' },
    ]);
  });

  it('reports unbuilt outputs as WM_COMMAND_FAILED with the build hint (fact 50)', async () => {
    await expect(new WorldMachineExporter(session()).exportAll()).rejects.toMatchObject({
      code: 'WM_COMMAND_FAILED',
      message: 'The outputs are not built; run build_project with mode full first',
      worldMachineMessage: "Error: Error: Some output devices are not built. Run 'build' first, then export.",
    });
  });

  it('exports after a full build and returns the reported paths', async () => {
    const s = session({ FAKE_WM_BUILD_MS: '50' });
    await new WorldMachineProjectWriter(s).saveProject(join(root, 'ex.tmd'), true);
    const build = new WorldMachineBuilder(s);
    await build.start('full');
    await build.waitForEnd('full', 2_000);
    expect(await new WorldMachineExporter(s).exportAll()).toEqual([
      join(root, 'ex Height Output-2049.png'),
      join(root, 'ex Material Output 2049.png'),
      join(root, 'ex Colormap only 2049.png'),
      join(root, 'ex Splatmap 2049.png'),
    ]);
  });

  it('confirms exportAlways off on the default project by id: false, or not found on a non-File Output (fact 55)', async () => {
    expect(
      await new WorldMachineExporter(session()).exportingAlways([
        'Height Output',
        'Material Output',
        'Colormap only',
        'Splatmap',
      ]),
    ).toEqual([]);
  });

  it('reports an exportAlways set in the World Machine window (fact 55)', async () => {
    const exporter = new WorldMachineExporter(session({ FAKE_WM_EXPORT_ALWAYS: '1' }));
    expect(await exporter.exportingAlways(['Height Output', 'Splatmap'])).toEqual(['Height Output']);
  });
});

/** `device list` rows as raw/device-list-sample.txt prints them. */
const row = (id: number, name: string, kind?: string) =>
  `  ${`#${id}`.padEnd(7)}${name.padEnd(24)}${kind === undefined ? '' : ` (${kind})`}`;

describe('WorldMachineExporter.exportingAlways fails closed (ruling P-FR-3)', () => {
  const exporter = (s: ReturnType<typeof scriptedSession>) => new WorldMachineExporter(s.session);
  const NOT_FOUND = (id: number) => `Error: Error: Parameter 'exportAlways' not found on device '#${id}'.`;

  it('counts one device reading false, and a non-File Output answering not found by id, as off', async () => {
    const s = scriptedSession({
      'device list': [
        { output: ['Devices (2 total):', row(1, 'Height Output'), row(308, 'Material Output')] },
      ],
      // raw/v2-build-isolate.txt l.17-26.
      'param get #1.exportAlways': [{ output: ['#1.exportAlways = false'] }],
      'param get #308.exportAlways': [{ errors: [NOT_FOUND(308)] }],
    });
    expect(await exporter(s).exportingAlways(['Height Output', 'Material Output'])).toEqual([]);
    expect(s.batches).toEqual([
      ['device list'],
      ['param get #1.exportAlways', 'param get #308.exportAlways'],
    ]);
  });

  it('resolves a name that differs only in case to the one device (fact 31)', async () => {
    const s = scriptedSession({
      'device list': [{ output: ['Devices (1 total):', row(1, 'Height Output')] }],
      'param get #1.exportAlways': [{ output: ['#1.exportAlways = false'] }],
    });
    expect(await exporter(s).exportingAlways(['height OUTPUT'])).toEqual([]);
  });

  it('counts a name several devices share, or no device has, as on without reading it (facts 30, 33)', async () => {
    const s = scriptedSession({
      'device list': [
        {
          output: [
            'Devices (3 total):',
            row(1, 'Height Output'),
            row(2, 'Height Output'),
            row(3, 'ABCDEFGHIJKLMNOPQRSTUVW', 'File Output'),
          ],
        },
      ],
      // A name longer than 23 characters resolves to its listed first 23 (fact 33).
      'param get #3.exportAlways': [{ output: ['#3.exportAlways = false'] }],
    });
    expect(
      await exporter(s).exportingAlways(['Height Output', 'Missing', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ']),
    ).toEqual(['Height Output', 'Missing']);
    expect(s.batches).toEqual([['device list'], ['param get #3.exportAlways']]);
  });

  it.each([
    ['true', { output: ['#1.exportAlways = true'] }],
    ['an unexpected reply', { output: ['#1.exportAlways = maybe'] }],
    ['a reply naming another device', { output: ['#2.exportAlways = false'] }],
    ['an empty reply', {}],
    ['another error', { errors: ["Error: Error: Device not found: '#1'"] }],
    ['not found for another id', { errors: [NOT_FOUND(2)] }],
  ])('counts %s as on', async (_case, reply) => {
    const s = scriptedSession({
      'device list': [{ output: ['Devices (1 total):', row(1, 'Height Output')] }],
      'param get #1.exportAlways': [reply],
    });
    expect(await exporter(s).exportingAlways(['Height Output'])).toEqual(['Height Output']);
  });
});
