import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { FsCatalogInstaller } from '../../src/adapter/out/fs/fs-catalog-installer.js';
import { FsPortTypeCorrections } from '../../src/adapter/out/fs/fs-port-type-corrections.js';
import { FsPathPolicy } from '../../src/adapter/out/fs/path-policy.js';
import { PHASE_MINUTES } from '../../src/adapter/out/worldmachine/capture/durations.js';
import { WorldMachineCatalogCapturer } from '../../src/adapter/out/worldmachine/capture/world-machine-catalog-capturer.js';
import { CatalogRegistry } from '../../src/adapter/out/worldmachine/catalog-registry.js';
import { ENUM_CATALOGS } from '../../src/adapter/out/worldmachine/enum-options.js';
import { resolveExecutable } from '../../src/adapter/out/worldmachine/locator.js';
import { PORT_TYPE_CATALOGS } from '../../src/adapter/out/worldmachine/world-machine-port-types.js';
import { WorldMachineProcess } from '../../src/adapter/out/worldmachine/world-machine-process.js';
import { WorldMachineSession } from '../../src/adapter/out/worldmachine/world-machine-session.js';
import { CatalogCaptureService } from '../../src/application/service/catalog-capture-service.js';
import { captureLogger } from '../support/fake-wm.js';

const executable = resolveExecutable(process.env.WORLD_MACHINE_BIN ?? null);
const LIVE = process.env.WM_LIVE === '1' && executable !== null;

const POLL_MS = 10_000;
const LIMIT_MS = 30 * 60_000;
// On 4069 the shipped catalog makes `short` refuse, so the registry here has none for 4069.
const WITHOUT_4069 = 4069;

describe.skipIf(!LIVE)('live short catalog capture (plan 3, task 11)', () => {
  const logger = captureLogger();
  // describe.skipIf still runs this body at collection, so only create the directory when the run is live.
  const liveRoot = LIVE ? mkdtempSync(join(tmpdir(), 'wm-live-capture-')) : '';
  const catalogDir = join(liveRoot, 'catalogs');
  const session = new WorldMachineSession({
    executable,
    defaultProject: undefined,
    pathPolicy: new FsPathPolicy([liveRoot]),
    commandTimeoutMs: 30_000,
    idleTimeoutMs: 0,
    logger,
    startProcess: (bin, signal, onSpawn) =>
      WorldMachineProcess.start({ bin, readyTimeoutMs: 120_000, logger, signal, onSpawn }),
  });
  const registry = new CatalogRegistry({
    portTypes: PORT_TYPE_CATALOGS.filter((entry) => entry.source.build !== WITHOUT_4069),
    shippedEnums: ENUM_CATALOGS.filter((catalog) => catalog.build !== WITHOUT_4069),
    catalogDir,
  });
  const capturer = new WorldMachineCatalogCapturer({ serverVersion: 'live-test' });
  const service = new CatalogCaptureService(
    {
      session,
      leases: session,
      capturer,
      transcripts: capturer,
      catalogs: registry,
      installer: new FsCatalogInstaller(catalogDir, new FsPortTypeCorrections(catalogDir, logger)),
      registry,
    },
    { catalogDir, serverVersion: 'live-test', phaseMinutes: PHASE_MINUTES },
    (name, fields) => logger.info(`catalog capture ${name}: ${JSON.stringify(fields)}`),
  );

  // Close-then-quit always runs, so the licence seat returns; a capture still running is cancelled first.
  afterAll(async () => {
    try {
      await service.cancel({});
      await session.shutdown();
    } finally {
      rmSync(liveRoot, { recursive: true, force: true });
    }
  }, 300_000);

  it(
    'captures a short catalog and installs it with an agreeing sample check',
    async () => {
      const started = await service.start({ mode: 'short', discardOpenProject: true });
      const deadline = Date.now() + LIMIT_MS;
      let view = started;
      while (view.outcome === undefined && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        view = (await service.status({})) ?? view;
      }
      expect(view.outcome?.kind, JSON.stringify(view.outcome)).toBe('installed');
      const folder = join(catalogDir, String(started.build));
      expect(existsSync(join(folder, 'port-types.json'))).toBe(true);
      expect(existsSync(join(folder, 'enum-options.json'))).toBe(true);
      const record = JSON.parse(readFileSync(join(folder, 'capture.json'), 'utf8')) as {
        sampleCheck?: string;
      };
      expect(record.sampleCheck).toBe('agreed');
    },
    35 * 60_000,
  );
});
