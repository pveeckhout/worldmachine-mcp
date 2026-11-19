// The capture seam in one piece (final review Minor 5): a short capture of an uncatalogued build, run on the simulated
// console with the real capturer, installer, and registry, answers the next get_device with the local catalog.
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { FsCatalogInstaller } from '../../../src/adapter/out/fs/fs-catalog-installer.js';
import { FsPortTypeCorrections } from '../../../src/adapter/out/fs/fs-port-type-corrections.js';
import { WorldMachineCatalogCapturer } from '../../../src/adapter/out/worldmachine/capture/world-machine-catalog-capturer.js';
import { CatalogRegistry } from '../../../src/adapter/out/worldmachine/catalog-registry.js';
import { ENUM_CATALOG_4067, ENUM_CATALOG_4069 } from '../../../src/adapter/out/worldmachine/enum-options.js';
import {
  PORT_TYPE_CATALOGS,
  WorldMachinePortTypes,
} from '../../../src/adapter/out/worldmachine/world-machine-port-types.js';
import type { ProjectGraphReadPort } from '../../../src/application/port/out/project-graph-read-port.js';
import type { WorldMachineSessionPort } from '../../../src/application/port/out/world-machine-session-port.js';
import { CatalogCaptureService } from '../../../src/application/service/catalog-capture-service.js';
import { GetDeviceService } from '../../../src/application/service/get-device-service.js';
import type { CapturePhase, CaptureView } from '../../../src/domain/catalog-capture.js';
import type { DeviceDetail } from '../../../src/domain/device.js';
import { captureLogger } from '../../support/fake-wm.js';
import { simulatedConsole } from '../../support/simulated-console.js';

const BUILD = 4071;
const MINUTES = { short: 9, full: 285 };
const PHASES: Record<CapturePhase, number> = {
  discover: 1,
  enum: 4,
  sample: 4,
  probe: 280,
  validate: 0,
  install: 0,
};

const session: WorldMachineSessionPort = {
  ensureRunning: async () => undefined,
  status: () => ({
    executable: '/wm',
    session: { state: 'ready', binding: { kind: 'fresh' }, dirty: false },
    systemInfo: { build: BUILD, buildName: 'Next', arch: 'x64' },
  }),
  shutdown: async () => undefined,
  forgetReopen: () => undefined,
  projectRevision: () => 0,
  projectSwitches: () => 0,
  exclusive: (action) => action(),
};

const device: DeviceDetail = {
  id: 1,
  name: 'B',
  type: 'Blur',
  enabled: true,
  bypassed: false,
  parameters: [],
  inputs: [],
  outputs: [],
  portTypes: 'unknown',
};
const graph: ProjectGraphReadPort = {
  listDevices: async () => [],
  getDevice: async () => device,
  getScene: async () => {
    throw new Error('not read');
  },
  inspectProject: async () => {
    throw new Error('not read');
  },
};

describe('a short capture through to get_device', () => {
  it('answers the next get_device with the local catalog and no capture offer', async () => {
    const catalogDir = mkdtempSync(join(tmpdir(), 'capture-e2e-'));
    const corrections = new FsPortTypeCorrections(catalogDir, captureLogger());
    const registry = new CatalogRegistry({
      portTypes: PORT_TYPE_CATALOGS,
      shippedEnums: [ENUM_CATALOG_4067, ENUM_CATALOG_4069],
      catalogDir,
    });
    const portTypes = new WorldMachinePortTypes(session, registry, [], corrections);
    const getDevice = new GetDeviceService(session, graph, portTypes, MINUTES, registry);
    const capturer = new WorldMachineCatalogCapturer({ serverVersion: '0.1.0-test' });
    const wm = simulatedConsole({ build: BUILD });
    const service = new CatalogCaptureService(
      {
        session,
        leases: { lease: () => wm.lease },
        capturer,
        transcripts: capturer,
        catalogs: registry,
        installer: new FsCatalogInstaller(catalogDir, corrections),
        registry,
      },
      { catalogDir, serverVersion: '0.1.0-test', phaseMinutes: PHASES },
      () => undefined,
    );

    const before = (await getDevice.getDevice({ device: '#1' })).catalog;
    expect(before).toMatchObject({ build: BUILD, portTypes: 'none' });
    expect(before.capture).toMatch(/^No catalog for build 4071\./);

    await service.start({ mode: 'short', discardOpenProject: false });
    const view = await vi.waitFor(
      async (): Promise<CaptureView> => {
        const status = await service.status({});
        if (status?.outcome === undefined) throw new Error('still running');
        return status;
      },
      { timeout: 30_000, interval: 50 },
    );
    expect(view.outcome).toMatchObject({ kind: 'installed', installed: ['enum-options', 'port-types'] });

    expect(portTypes.catalogInUse()).toEqual({ build: BUILD, kind: 'sample-derived', origin: 'local' });
    expect((await getDevice.getDevice({ device: '#1' })).catalog).toStrictEqual({
      build: BUILD,
      portTypes: 'local short',
      corrections: false,
    });
    expect(existsSync(join(catalogDir, String(BUILD), 'port-types.json'))).toBe(true);
    expect(existsSync(join(catalogDir, String(BUILD), '.capture-short'))).toBe(false);
    expect(JSON.parse(readFileSync(join(catalogDir, String(BUILD), 'capture.json'), 'utf8'))).toMatchObject({
      mode: 'short',
      baseBuild: 4067,
      sampleCheck: 'agreed',
      discoveryIncomplete: true,
    });
  }, 60_000);
});
