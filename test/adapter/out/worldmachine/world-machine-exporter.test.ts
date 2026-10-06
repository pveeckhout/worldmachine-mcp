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
});
