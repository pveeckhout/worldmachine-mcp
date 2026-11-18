import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ENUM_CATALOG_4069 } from '../../../src/adapter/out/worldmachine/enum-options.js';
import {
  PORT_TYPE_CATALOG_4067,
  PORT_TYPE_CATALOG_4069,
} from '../../../src/adapter/out/worldmachine/world-machine-port-types.js';
import type { DiscardCaptureTranscriptPort } from '../../../src/application/port/out/discard-capture-transcript-port.js';
import type {
  CatalogInstall,
  InstallCatalogPort,
} from '../../../src/application/port/out/install-catalog-port.js';
import type { LeaseSessionPort, SessionLease } from '../../../src/application/port/out/lease-session-port.js';
import type { ListCatalogsPort } from '../../../src/application/port/out/list-catalogs-port.js';
import type { RegisterCatalogsPort } from '../../../src/application/port/out/register-catalogs-port.js';
import type {
  CaptureResult,
  CaptureRun,
  RunCatalogCapturePort,
} from '../../../src/application/port/out/run-catalog-capture-port.js';
import type { WorldMachineSessionPort } from '../../../src/application/port/out/world-machine-session-port.js';
import { CatalogCaptureService } from '../../../src/application/service/catalog-capture-service.js';
import type { EnumCatalog, PortTypeCatalog, SourcedPortTypeCatalog } from '../../../src/domain/catalog.js';
import type { CapturePhase, CaptureProgress, CaptureView } from '../../../src/domain/catalog-capture.js';
import { WorldMachineError } from '../../../src/domain/errors.js';

const MINUTES: Record<CapturePhase, number> = {
  discover: 1,
  enum: 6,
  sample: 4,
  probe: 300,
  validate: 0,
  install: 0,
};
const BUILD = 4071;
const ENUMS: EnumCatalog = {
  build: BUILD,
  types: { Blur: ENUM_CATALOG_4069.types.Blur as EnumCatalog['types'][string] },
};
const SAMPLED: PortTypeCatalog = { ...PORT_TYPE_CATALOG_4069, build: BUILD };
const DISCOVERY = {
  types: [{ addName: 'Blur', aliases: [], reached: true }],
  notReached: ['Bias/Gain'],
  listedByConsole: true,
  sections: [],
};

const agreed = (): CaptureResult => ({
  enumOptions: ENUMS,
  portTypes: {
    agreed: true,
    catalog: SAMPLED,
    omittedTypes: ['Bias/Gain'],
    untypedTypes: ['New Type'],
    movedWords: [],
  },
  discovery: DISCOVERY,
  refusedWords: ['Brightness'],
});
const disagreed = (): CaptureResult => ({
  enumOptions: ENUMS,
  portTypes: {
    agreed: false,
    disagreement: "type 'Blur': other ports than in the build 4067 catalog",
    omittedTypes: [],
    untypedTypes: [],
  },
  discovery: DISCOVERY,
  refusedWords: [],
});

type Script = (
  run: CaptureRun,
  onProgress: (p: CaptureProgress) => void,
  signal: AbortSignal,
) => Promise<CaptureResult>;

/** Waits until the given signal aborts, then rejects as the capturer does. */
const untilCancelled: Script = (_run, onProgress, signal) =>
  new Promise((_resolve, reject) => {
    onProgress({ phase: 'enum', done: 3, total: 10 });
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });

function fakes(
  options: {
    script?: Script;
    dirty?: boolean;
    catalogs?: readonly SourcedPortTypeCatalog[];
    install?: (entry: CatalogInstall) => void;
    build?: number;
    onEvent?: (name: string, fields: Record<string, unknown>) => void;
  } = {},
) {
  const calls: string[] = [];
  const installs: CatalogInstall[] = [];
  const registered: Parameters<RegisterCatalogsPort['add']>[] = [];
  const runs: CaptureRun[] = [];
  const discarded: string[] = [];
  const events: [string, Record<string, unknown>][] = [];
  let held: (() => string) | undefined;
  let released = 0;
  const session: WorldMachineSessionPort = {
    ensureRunning: async () => void calls.push('ensureRunning'),
    status: () => ({
      executable: '/wm',
      session: { state: 'ready', binding: { kind: 'fresh' }, dirty: options.dirty ?? false },
      systemInfo: { build: options.build ?? BUILD, buildName: 'Next', arch: 'x64' },
    }),
    shutdown: async () => undefined,
    forgetReopen: () => undefined,
    projectRevision: () => 0,
    projectSwitches: () => 0,
    exclusive: (action) => action(),
  };
  const leases: LeaseSessionPort = {
    lease: (busy) => {
      if (held) throw new WorldMachineError('CAPTURING', held());
      held = busy;
      calls.push('lease');
      const lease: SessionLease = {
        execute: async () => [],
        bindFresh: () => undefined,
        release: () => {
          if (held === undefined) return;
          held = undefined;
          released++;
          calls.push('release');
        },
      };
      return lease;
    },
  };
  const capturer: RunCatalogCapturePort = {
    run: (run, _lease, onProgress, signal) => {
      runs.push(run);
      return (options.script ?? (async () => agreed()))(run, onProgress, signal);
    },
  };
  const transcripts: DiscardCaptureTranscriptPort = { discard: (dir) => void discarded.push(dir) };
  const catalogs: ListCatalogsPort = {
    portTypeCatalogs: () =>
      options.catalogs ?? [
        { catalog: PORT_TYPE_CATALOG_4067, source: { build: 4067, kind: 'strict', origin: 'shipped' } },
        {
          catalog: PORT_TYPE_CATALOG_4069,
          source: { build: 4069, kind: 'sample-derived', origin: 'shipped' },
        },
      ],
    enumCatalogs: () => [ENUM_CATALOG_4069],
  };
  const installer: InstallCatalogPort = {
    install: (entry, runningBuild) => {
      calls.push(`install ${runningBuild}`);
      options.install?.(entry);
      installs.push(entry);
    },
  };
  const registry: RegisterCatalogsPort = {
    add: (...args) => {
      calls.push('register');
      registered.push(args);
    },
  };
  const service = new CatalogCaptureService(
    { session, leases, capturer, transcripts, catalogs, installer, registry },
    { catalogDir: '/catalogs', serverVersion: '0.1.0-test', phaseMinutes: MINUTES, now: () => new Date(0) },
    (name, fields) => {
      events.push([name, fields]);
      options.onEvent?.(name, fields);
    },
  );
  return {
    service,
    calls,
    installs,
    registered,
    runs,
    discarded,
    events,
    released: () => released,
    held: () => held,
  };
}

const short = { mode: 'short', discardOpenProject: false } as const;
const full = { mode: 'full', discardOpenProject: false } as const;

async function finished(service: CatalogCaptureService): Promise<CaptureView> {
  return vi.waitFor(async () => {
    const view = await service.status({});
    if (view?.outcome === undefined) throw new Error('still running');
    return view;
  });
}

describe('CatalogCaptureService', () => {
  it('starts a run in the background and returns the first view', async () => {
    const f = fakes({ script: untilCancelled });
    const view = await f.service.start(short);
    expect(view).toMatchObject({ build: BUILD, mode: 'short', phase: 'discover', percent: 0 });
    expect(f.calls.slice(0, 2)).toEqual(['ensureRunning', 'lease']);
    expect(f.runs[0]).toMatchObject({
      build: BUILD,
      mode: 'short',
      base: PORT_TYPE_CATALOG_4067,
      workDir: join('/catalogs', String(BUILD), '.capture-short'),
    });
    expect(f.runs[0]?.known.addWords).toEqual(expect.arrayContaining(['Blur', 'Add Noise']));
    expect(f.runs[0]?.known.typeNames).toEqual(expect.arrayContaining(['Blur', 'Bias/Gain']));
    expect(await f.service.status({})).toMatchObject({ phase: 'enum' });
    // The busy message of the lease reports the live view.
    expect(f.held()?.()).toMatch(/^World Machine is capturing the catalog of build 4071 \(short, enum, /);
    await f.service.cancel({});
  });

  it('refuses a start while a capture runs', async () => {
    const f = fakes({ script: untilCancelled });
    await f.service.start(short);
    await expect(f.service.start(short)).rejects.toMatchObject({ code: 'CAPTURING' });
    await f.service.cancel({});
  });

  it('refuses when the open project has unsaved changes', async () => {
    const f = fakes({ dirty: true });
    await expect(f.service.start(short)).rejects.toMatchObject({
      code: 'REFUSED',
      message: expect.stringMatching(/unsaved changes.*closes the open project first.*discardOpenProject/),
    });
    expect(f.calls).not.toContain('lease');
    const g = fakes({ dirty: true });
    await g.service.start({ mode: 'short', discardOpenProject: true });
    expect((await finished(g.service)).outcome?.kind).toBe('installed');
  });

  it('refuses a build that has a strict catalog, and a short run over any port-type catalog', async () => {
    await expect(fakes({ build: 4067 }).service.start(full)).rejects.toMatchObject({
      code: 'REFUSED',
      message: expect.stringMatching(/build 4067 already has a strict catalog/),
    });
    await expect(fakes({ build: 4069 }).service.start(short)).rejects.toMatchObject({ code: 'REFUSED' });
  });

  it('refuses a short run without a strict catalog to check against', async () => {
    const f = fakes({ catalogs: [] });
    await expect(f.service.start(short)).rejects.toMatchObject({
      code: 'REFUSED',
      message: expect.stringMatching(/strict catalog.*mode full/),
    });
  });

  it('installs both catalogs when the sample agrees, registers them, and removes the working folder', async () => {
    const f = fakes();
    await f.service.start(short);
    const view = await finished(f.service);
    expect(view).toMatchObject({
      percent: 100,
      outcome: { kind: 'installed', installed: ['enum-options', 'port-types'] },
    });
    expect(f.installs[0]).toMatchObject({
      build: BUILD,
      enumOptions: ENUMS,
      portTypes: SAMPLED,
      record: {
        mode: 'short',
        serverVersion: '0.1.0-test',
        baseBuild: 4067,
        sampleCheck: 'agreed',
        notCaptured: ['Bias/Gain'],
        untypedTypes: ['New Type'],
        deviceTypes: [
          { addName: 'Blur', aliases: [], reached: true },
          { addName: 'Bias/Gain', aliases: [], reached: false },
        ],
      },
    });
    expect(f.registered).toEqual([
      [
        BUILD,
        {
          enumOptions: ENUMS,
          portTypes: { catalog: SAMPLED, source: { build: BUILD, kind: 'sample-derived', origin: 'local' } },
        },
      ],
    ]);
    expect(f.calls.slice(-3)).toEqual([`install ${BUILD}`, 'register', 'release']);
    expect(f.discarded).toEqual([join('/catalogs', String(BUILD), '.capture-short')]);
    expect(f.events.map(([name]) => name)).toEqual(['catalog_capture_started', 'catalog_capture_finished']);
  });

  it('installs only enum options when the sample disagrees', async () => {
    const f = fakes({ script: async () => disagreed() });
    await f.service.start(short);
    const view = await finished(f.service);
    expect(view.outcome).toMatchObject({
      kind: 'sample-disagreed',
      disagreement: expect.stringContaining("type 'Blur'"),
      installed: ['enum-options'],
    });
    expect(view.percent).toBeLessThan(100);
    expect(f.installs).toHaveLength(1);
    expect(f.installs[0]?.portTypes).toBeUndefined();
    expect(f.installs[0]?.record.sampleCheck).toBe("type 'Blur': other ports than in the build 4067 catalog");
    expect(f.registered).toEqual([[BUILD, { enumOptions: ENUMS }]]);
    expect(f.released()).toBe(1);
  });

  it('installs a full run as a strict local catalog', async () => {
    const strict: PortTypeCatalog = { ...PORT_TYPE_CATALOG_4067, build: BUILD };
    const f = fakes({
      script: async () => ({ ...agreed(), portTypes: { agreed: true, catalog: strict } }),
    });
    await f.service.start(full);
    expect((await finished(f.service)).outcome).toMatchObject({ kind: 'installed' });
    expect(f.runs[0]?.workDir).toBe(join('/catalogs', String(BUILD), '.capture-full'));
    expect(f.installs[0]?.record).not.toHaveProperty('baseBuild');
    expect(f.registered[0]?.[1].portTypes?.source).toEqual({ build: BUILD, kind: 'strict', origin: 'local' });
  });

  it('cancels between batches and keeps the transcript', async () => {
    const f = fakes({ script: untilCancelled });
    await f.service.start(short);
    const view = await f.service.cancel({});
    expect(view?.outcome).toEqual({ kind: 'cancelled' });
    expect(view?.percent).toBeLessThan(100);
    expect(f.discarded).toEqual([]);
    expect(f.installs).toEqual([]);
    expect(f.released()).toBe(1);
    expect(await f.service.cancel({})).toBeNull();
  });

  it('ends failed when the run rejects, and releases the lease', async () => {
    const f = fakes({
      script: async () => {
        throw new WorldMachineError('CRASHED', 'World Machine exited unexpectedly');
      },
    });
    await f.service.start(short);
    const view = await finished(f.service);
    expect(view.outcome).toEqual({ kind: 'failed', reason: 'World Machine exited unexpectedly' });
    expect(view.percent).toBeLessThan(100);
    expect(f.released()).toBe(1);
    expect(f.discarded).toEqual([]);
    expect(f.events.at(-1)).toEqual([
      'catalog_capture_finished',
      expect.objectContaining({
        build: BUILD,
        mode: 'short',
        outcome: 'failed',
        reason: 'World Machine exited unexpectedly',
      }),
    ]);
  });

  it('ends failed when the capturer throws at once', async () => {
    const f = fakes({
      script: () => {
        throw new Error('no working folder');
      },
    });
    await f.service.start(short);
    expect((await finished(f.service)).outcome).toEqual({ kind: 'failed', reason: 'no working folder' });
    expect(f.released()).toBe(1);
  });

  it('ends failed when the install fails, keeps the transcript, and registers nothing', async () => {
    const f = fakes({
      install: () => {
        throw new Error('type Blur has no outputs list');
      },
    });
    await f.service.start(short);
    expect((await finished(f.service)).outcome).toEqual({
      kind: 'failed',
      reason: 'type Blur has no outputs list',
    });
    expect(f.registered).toEqual([]);
    expect(f.discarded).toEqual([]);
    expect(f.released()).toBe(1);
    expect(f.events.at(-1)?.[0]).toBe('catalog_capture_finished');
  });

  it('still finishes when the event sink throws', async () => {
    const f = fakes({
      onEvent: () => {
        throw new Error('log sink down');
      },
    });
    await f.service.start(short);
    expect((await finished(f.service)).outcome?.kind).toBe('installed');
    expect(f.released()).toBe(1);
  });

  it('has no status before a start, and keeps the finished capture until the next start', async () => {
    const f = fakes();
    expect(await f.service.status({})).toBeNull();
    await f.service.start(short);
    await finished(f.service);
    expect((await f.service.status({}))?.outcome?.kind).toBe('installed');
    const again = await f.service.start(short);
    expect(again.outcome).toBeUndefined();
    await finished(f.service);
  });
});
