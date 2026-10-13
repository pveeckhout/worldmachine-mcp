import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BuildPort } from '../../../src/application/port/out/build-port.js';
import type { BuildResultPort } from '../../../src/application/port/out/build-result-port.js';
import type { GroupPort } from '../../../src/application/port/out/group-port.js';
import type { WorldMachineSessionPort } from '../../../src/application/port/out/world-machine-session-port.js';
import { BuildProjectService } from '../../../src/application/service/build-project-service.js';
import { NEVER_SAVED } from '../../../src/application/service/export-rules.js';
import { GetBuildStatusService } from '../../../src/application/service/get-build-status-service.js';
import {
  LastFullBuildRecord,
  PROJECT_CHANGED,
  RESULTS_GONE,
} from '../../../src/application/service/last-full-build-record.js';
import { OutputsChecker } from '../../../src/application/service/outputs-checker.js';
import { StopBuildService } from '../../../src/application/service/stop-build-service.js';
import type { BuildMode, BuildRun, RunMode } from '../../../src/domain/build.js';
import { NOT_BUILT_HINT } from '../../../src/domain/build-result.js';
import type { DeviceDetail, DeviceSummary, InputPort } from '../../../src/domain/device.js';
import { WorldMachineError } from '../../../src/domain/errors.js';
import type { Group } from '../../../src/domain/group.js';
import {
  DEFAULT_PATHS,
  type ExportFakeOptions,
  exportFakes,
  SAVED,
  UNSAVED,
} from '../../support/port-fakes.js';

type BuildFakeOptions = {
  readonly run?: BuildRun;
  /** Successive `build status` answers; the last one repeats. */
  readonly previews?: readonly boolean[];
  readonly wait?: (mode: BuildMode | RunMode, ms: number, signal?: AbortSignal) => Promise<boolean>;
};

/**
 * A BuildPort that records its calls into `calls`, as `exportFakes` does. `end()` ends its run as the tracker would;
 * `exit()` drops it as a World Machine exit does (`last()` has no run).
 */
function buildFake(
  calls: string[],
  options: BuildFakeOptions = {},
): BuildPort & { readonly end: () => void; readonly exit: () => void } {
  let run = options.run;
  const previews = [...(options.previews ?? [false])];
  return {
    end: () => {
      if (run !== undefined) run = { ...run, state: 'ended' };
    },
    exit: () => {
      run = undefined;
    },
    current: () => (run?.state === 'running' ? run : undefined),
    last: () => run,
    awaitStart: async () => undefined,
    start: async (mode, group) => {
      calls.push(group === undefined ? `start ${mode}` : `start ${mode} #${group.index}`);
      if (mode === 'preview') return;
      // Spec v2b section 5: a group build runs as a full run.
      run = {
        mode: mode === 'tiled' ? 'tiled' : 'full',
        startedAt: Date.now(),
        startedBy: 'server',
        state: 'running',
      };
    },
    previewRunning: async () => {
      calls.push('build status');
      return (previews.length > 1 ? previews.shift() : previews[0]) ?? false;
    },
    stop: async () => void calls.push('build stop'),
    waitForEnd: async (mode, ms, signal) => {
      calls.push(`wait ${mode} ${ms}`);
      return options.wait ? options.wait(mode, ms, signal) : true;
    },
    forgetRun: () => {
      calls.push('forget');
      run = undefined;
    },
  };
}

// raw/v2b-groups.txt l.16-24.
const TERRAIN: Group = { index: 0, name: 'Create your Terrain', deviceCount: 6 };
const WELCOME: Group = { index: 3, name: 'Welcome to World Machine!', deviceCount: 0 };

/** A GroupPort that resolves the two groups above by name or index, recording its calls into `calls`. */
function groupsFake(calls: string[]): GroupPort {
  const unused = async (): Promise<never> => {
    throw new Error('not used by the build service');
  };
  return {
    list: unused,
    setEnabled: unused,
    resolve: async (reference) => {
      calls.push(`resolve ${reference}`);
      const group = [TERRAIN, WELCOME].find(
        (candidate) => reference === `#${candidate.index}` || reference === candidate.name,
      );
      if (group === undefined) {
        throw new WorldMachineError(
          'REFUSED',
          `No group '${reference}' in the current project; see list_groups`,
        );
      }
      return group;
    },
  };
}

type ResultsFakeOptions = {
  /** Ids without a result after the build (fact 93). */
  readonly unbuilt?: readonly number[];
  /** Thrown by builtDevices instead of answering. */
  readonly failure?: Error;
  /** Thrown by the first builtDevices call only. */
  readonly failOnce?: Error;
};

/** A BuildResultPort that records each batch into `calls` as one `devicetiming` line. */
function resultsFake(calls: string[], options: ResultsFakeOptions = {}): BuildResultPort {
  let once = options.failOnce;
  return {
    builtDevices: async (ids) => {
      calls.push(`devicetiming ${ids.map((id) => `#${id}`).join(', ')}`);
      if (options.failure !== undefined) throw options.failure;
      if (once !== undefined) {
        const failure = once;
        once = undefined;
        throw failure;
      }
      return ids.filter((id) => !options.unbuilt?.includes(id));
    },
  };
}

const detailOf = (
  id: number,
  name: string,
  type: string,
  inputs: readonly InputPort[] = [],
): DeviceDetail => ({
  id,
  name,
  type,
  enabled: true,
  bypassed: false,
  parameters: [],
  inputs,
  outputs: [],
});

// raw/v2-build-export.txt l.15-20 and fixtures/wm-4067/device-list.txt l.2, l.11, l.12, and l.16: the default project's
// four outputs, read here without inputs, so the output check reads only them.
const OUTPUT_DEVICES: readonly DeviceSummary[] = [
  { id: 1, name: 'Height Output', enabled: true, bypassed: false },
  { id: 308, name: 'Material Output', enabled: true, bypassed: false },
  { id: 309, name: 'Colormap only', kind: 'Bitmap Output', enabled: true, bypassed: false },
  { id: 318, name: 'Splatmap', kind: 'Bitmap Output', enabled: true, bypassed: false },
];
const OUTPUT_DETAILS: readonly DeviceDetail[] = [
  detailOf(1, 'Height Output', 'Height Output'),
  detailOf(308, 'Material Output', 'Material Output'),
  detailOf(309, 'Colormap only', 'Bitmap Output'),
  detailOf(318, 'Splatmap', 'Bitmap Output'),
];
/** The output check after a finished full build of the default outputs (build-not-built design section 4). */
const OUTPUT_CHECK_CALLS = [
  'exclusive',
  'export list',
  'device list',
  // Design section 4 step 2: the timing of every listed device comes before any read that selects a device.
  'devicetiming #1, #308, #309, #318',
  'device info #1',
  'device info #308',
  'device info #309',
  'device info #318',
  'exclusive end',
];

function building(
  build: BuildFakeOptions = {},
  ports: ExportFakeOptions = {},
  results: ResultsFakeOptions = {},
) {
  const f = exportFakes({ devices: OUTPUT_DEVICES, details: OUTPUT_DETAILS, ...ports });
  const port = buildFake(f.calls, build);
  // Build-status-check design section 6: one record, shared by both services as in main.ts.
  const lastFullBuild = new LastFullBuildRecord();
  return {
    ...f,
    port,
    lastFullBuild,
    service: new BuildProjectService(
      f.session,
      port,
      f.exports,
      f.graph,
      f.policy,
      groupsFake(f.calls),
      resultsFake(f.calls, results),
      lastFullBuild,
    ),
    status: new GetBuildStatusService(
      f.session,
      port,
      lastFullBuild,
      new OutputsChecker(f.session, f.exports, f.graph, resultsFake(f.calls, results)),
    ),
  };
}

/** get_build_status with a record and checker of its own, over the fakes of `f` (plan decision D6). */
function statusService(f: ReturnType<typeof exportFakes>, port: BuildPort): GetBuildStatusService {
  return new GetBuildStatusService(
    f.session,
    port,
    new LastFullBuildRecord(),
    new OutputsChecker(f.session, f.exports, f.graph, resultsFake(f.calls)),
  );
}

async function failure(promise: Promise<unknown>): Promise<WorldMachineError> {
  try {
    await promise;
  } catch (error) {
    return error as WorldMachineError;
  }
  throw new Error('expected rejection');
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.useRealTimers();
});

const RUNNING_FULL: BuildRun = { mode: 'full', startedAt: 0, startedBy: 'server', state: 'running' };
/** A tiled build started in the World Machine window, before any end: only its sleep-prohibited arrived (A1). */
const RUNNING_UNKNOWN: BuildRun = {
  mode: 'unknown',
  startedAt: 0,
  startedBy: 'world-machine',
  state: 'running',
};

describe('BuildProjectService (spec v2a section 4)', () => {
  it('starts a full build inside exclusive() and waits for it outside', async () => {
    const f = building({
      wait: async () => {
        vi.setSystemTime(12_500);
        return true;
      },
    });
    expect(await f.service.buildProject({ mode: 'full', waitSeconds: 60 })).toEqual({
      state: 'finished',
      mode: 'full',
      elapsedSeconds: 12,
      outputsBuilt: true,
      notBuilt: [],
      stoppedAt: [],
      session: SAVED,
    });
    expect(f.calls).toEqual([
      'exclusive',
      'export list',
      'exportAlways Height Output, Material Output, Colormap only, Splatmap',
      'start full',
      'exclusive end',
      'wait full 60000',
      ...OUTPUT_CHECK_CALLS,
    ]);
  });

  it('checks every export target before a full build when a File Output has exportAlways set (fact 55)', async () => {
    const f = building({}, { exportAlways: ['Height Output'] });
    expect(await f.service.buildProject({ mode: 'full', waitSeconds: 60 })).toEqual({
      state: 'finished',
      mode: 'full',
      elapsedSeconds: 0,
      outputsBuilt: true,
      notBuilt: [],
      stoppedAt: [],
      session: SAVED,
    });
    expect(f.calls).toEqual([
      'exclusive',
      'export list',
      'exportAlways Height Output, Material Output, Colormap only, Splatmap',
      'ensureRunning',
      'export list',
      'scene show',
      ...DEFAULT_PATHS.map((path) => `authorize ${path}`),
      'start full',
      'exclusive end',
      'wait full 60000',
      ...OUTPUT_CHECK_CALLS,
    ]);
  });

  it('refuses a full build with exportAlways set for a project never saved, without starting it', async () => {
    const f = building({}, { session: UNSAVED, exportAlways: ['Height Output'] });
    expect(await failure(f.service.buildProject({ mode: 'full', waitSeconds: 60 }))).toMatchObject({
      code: 'REFUSED',
      message:
        "Save the project inside the allowed roots before a full build that writes outputs ('Height Output' has exportAlways set): " +
        `${NEVER_SAVED}.`,
    });
    expect(f.calls).not.toContain('start full');
  });

  it('refuses a full build with exportAlways set when a target is refused, naming it', async () => {
    const f = building(
      {},
      {
        exportAlways: ['Height Output'],
        refuse: (path) =>
          path.includes('Splatmap') ? 'The output folder does not exist: /r/maps' : undefined,
      },
    );
    const error = await failure(f.service.buildProject({ mode: 'full', waitSeconds: 60 }));
    expect(error.code).toBe('REFUSED');
    expect(error.message).toContain("'Splatmap': The output folder does not exist: /r/maps");
    expect(f.calls).not.toContain('start full');
  });

  it('reads no exportAlways for a preview or a tiled build', async () => {
    const preview = building({}, { exportAlways: ['Height Output'] });
    await preview.service.buildProject({ mode: 'preview', waitSeconds: 0 });
    expect(preview.calls).toEqual(['exclusive', 'start preview', 'exclusive end', 'wait preview 0']);
    const tiled = building({}, { exportAlways: ['Height Output'] });
    await tiled.service.buildProject({ mode: 'tiled', waitSeconds: 0 });
    expect(tiled.calls.some((call) => call.startsWith('exportAlways'))).toBe(false);
  });

  it('returns running when the wait bound passes, and passes the cancellation signal on', async () => {
    let received: AbortSignal | undefined;
    const f = building({
      wait: async (_mode, _ms, signal) => {
        received = signal;
        return false;
      },
    });
    const abort = new AbortController();
    const view = await f.service.buildProject({ mode: 'preview', waitSeconds: 0, signal: abort.signal });
    expect(view).toMatchObject({ state: 'running', mode: 'preview' });
    expect(received).toBe(abort.signal);
    expect(f.calls).toContain('wait preview 0');
  });

  it('starts nothing when the call was cancelled while it waited for exclusive() (Minor 3)', async () => {
    const f = building();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const exclusive = f.session.exclusive;
    const queued: typeof f.session = {
      ...f.session,
      exclusive: async (action) => {
        await gate;
        return exclusive(action);
      },
    };
    const service = new BuildProjectService(
      queued,
      buildFake(f.calls),
      f.exports,
      f.graph,
      f.policy,
      groupsFake(f.calls),
      resultsFake(f.calls),
      new LastFullBuildRecord(),
    );
    const abort = new AbortController();
    const view = service.buildProject({ mode: 'full', waitSeconds: 60, signal: abort.signal });
    abort.abort();
    release();
    // As for a cancelled wait: the call returns, reporting the build as not finished.
    expect(await view).toEqual({ state: 'running', mode: 'full', elapsedSeconds: 0, session: SAVED });
    expect(f.calls).toEqual(['exclusive', 'exclusive end']);
  });

  it('reports elapsed seconds every 5 s while it waits', async () => {
    const progress: number[] = [];
    const f = building({ wait: () => new Promise((resolve) => setTimeout(() => resolve(true), 12_000)) });
    const view = f.service.buildProject({
      mode: 'full',
      waitSeconds: 60,
      onProgress: (seconds) => progress.push(seconds),
    });
    await vi.advanceTimersByTimeAsync(12_000);
    expect(await view).toMatchObject({ state: 'finished', elapsedSeconds: 12 });
    expect(progress).toEqual([5, 10]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(progress).toEqual([5, 10]);
  });

  it('checks every export target before a tiled build and returns its folders (spec v2a section 6)', async () => {
    const f = building();
    expect(await f.service.buildProject({ mode: 'tiled', waitSeconds: 60 })).toEqual({
      state: 'finished',
      mode: 'tiled',
      elapsedSeconds: 0,
      outputFolders: ['/r/maps'],
      session: SAVED,
    });
    expect(f.calls).toEqual([
      'exclusive',
      'ensureRunning',
      'export list',
      'scene show',
      ...DEFAULT_PATHS.map((path) => `authorize ${path}`),
      'start tiled',
      'exclusive end',
      'wait tiled 60000',
    ]);
  });

  it('returns the folders of the expanded paths, not of the canonical ones (Minor 4)', async () => {
    const f = building({}, { canonical: (path) => path.replace('/r/', '/real/r/') });
    expect((await f.service.buildProject({ mode: 'tiled', waitSeconds: 60 })).outputFolders).toEqual([
      '/r/maps',
    ]);
  });

  it('refuses a tiled build of a project never saved without starting it', async () => {
    const f = building({}, { session: UNSAVED });
    expect(await failure(f.service.buildProject({ mode: 'tiled', waitSeconds: 60 }))).toMatchObject({
      code: 'REFUSED',
      message: `Save the project inside the allowed roots before a tiled build: ${NEVER_SAVED}.`,
    });
    expect(f.calls).not.toContain('start tiled');
  });

  it('refuses a tiled build when a target is refused, naming it', async () => {
    const f = building(
      {},
      {
        refuse: (path) =>
          path.includes('Splatmap') ? 'The output folder does not exist: /r/maps' : undefined,
      },
    );
    const error = await failure(f.service.buildProject({ mode: 'tiled', waitSeconds: 60 }));
    expect(error.code).toBe('REFUSED');
    expect(error.message).toContain("'Splatmap': The output folder does not exist: /r/maps");
    expect(f.calls).not.toContain('start tiled');
  });

  it('refuses a tiled build whose template uses <res> in a folder name (decision D9)', async () => {
    const f = building({}, { targets: [{ device: 'Height Output', template: 'tiles-<res>/<name>.png' }] });
    const error = await failure(f.service.buildProject({ mode: 'tiled', waitSeconds: 60 }));
    expect(error.code).toBe('REFUSED');
    expect(error.message).toContain('tile resolution');
    expect(f.calls).not.toContain('start tiled');
  });

  it('allows <res> in a folder name for a full build, which writes no files', async () => {
    const f = building({}, { targets: [{ device: 'Height Output', template: 'tiles-<res>/<name>.png' }] });
    expect((await f.service.buildProject({ mode: 'full', waitSeconds: 60 })).state).toBe('finished');
  });
});

describe('BuildProjectService mode group (spec v2b section 3)', () => {
  it('resolves the group, checks exportAlways, and starts it inside exclusive(), then waits outside', async () => {
    const f = building();
    expect(
      await f.service.buildProject({ mode: 'group', group: 'Create your Terrain', waitSeconds: 60 }),
    ).toEqual({ state: 'finished', mode: 'group', elapsedSeconds: 0, group: TERRAIN, session: SAVED });
    expect(f.calls).toEqual([
      'exclusive',
      'resolve Create your Terrain',
      'export list',
      'exportAlways Height Output, Material Output, Colormap only, Splatmap',
      'start group #0',
      'exclusive end',
      'wait group 60000',
    ]);
  });

  it.each([
    [
      { mode: 'group' as const },
      'build_project with mode group needs group: a group name or #<index> (see list_groups)',
    ],
    [{ mode: 'full' as const, group: '#0' }, 'group applies only to mode group, not to mode full'],
    [{ mode: 'tiled' as const, group: '#0' }, 'group applies only to mode group, not to mode tiled'],
    [{ mode: 'preview' as const, group: '#0' }, 'group applies only to mode group, not to mode preview'],
  ])('refuses %j before anything is sent', async (input, message) => {
    const f = building();
    expect(await failure(f.service.buildProject({ ...input, waitSeconds: 60 }))).toMatchObject({
      code: 'REFUSED',
      message,
    });
    expect(f.calls).toEqual([]);
  });

  it('builds the view of the group field by field (final review F4)', async () => {
    const f = building();
    const groups = groupsFake(f.calls);
    const extended = { ...TERRAIN, filter: 'Terrain' };
    const service = new BuildProjectService(
      f.session,
      buildFake(f.calls),
      f.exports,
      f.graph,
      f.policy,
      { ...groups, resolve: async () => extended },
      resultsFake(f.calls),
      new LastFullBuildRecord(),
    );
    const view = await service.buildProject({ mode: 'group', group: '#0', waitSeconds: 60 });
    expect(view.group).toStrictEqual(TERRAIN);
  });

  it('refuses a group without devices without starting it (decision D8)', async () => {
    const f = building();
    expect(
      await failure(f.service.buildProject({ mode: 'group', group: '#3', waitSeconds: 60 })),
    ).toMatchObject({
      code: 'REFUSED',
      message: "Group #3 'Welcome to World Machine!' contains no devices, so there is nothing to build",
    });
    expect(f.calls).toEqual(['exclusive', 'resolve #3', 'exclusive end']);
  });

  it('returns running without a group when a group build is cancelled while it queued for exclusive()', async () => {
    // Records the current behaviour only: the SDK sends no result for an aborted request, so no client sees this view.
    const f = building();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const exclusive = f.session.exclusive;
    const queued: typeof f.session = {
      ...f.session,
      exclusive: async (action) => {
        await gate;
        return exclusive(action);
      },
    };
    const service = new BuildProjectService(
      queued,
      buildFake(f.calls),
      f.exports,
      f.graph,
      f.policy,
      groupsFake(f.calls),
      resultsFake(f.calls),
      new LastFullBuildRecord(),
    );
    const abort = new AbortController();
    const view = service.buildProject({ mode: 'group', group: '#0', waitSeconds: 60, signal: abort.signal });
    abort.abort();
    release();
    expect(await view).toEqual({ state: 'running', mode: 'group', elapsedSeconds: 0, session: SAVED });
    expect(f.calls).toEqual(['exclusive', 'exclusive end']);
  });

  it('passes a refused group reference on without starting anything', async () => {
    const f = building();
    expect(
      await failure(f.service.buildProject({ mode: 'group', group: 'missing', waitSeconds: 60 })),
    ).toMatchObject({
      code: 'REFUSED',
      message: "No group 'missing' in the current project; see list_groups",
    });
    expect(f.calls).toEqual(['exclusive', 'resolve missing', 'exclusive end']);
  });

  it('checks every export target before a group build when an output has exportAlways set (assumption B5)', async () => {
    const f = building({}, { session: UNSAVED, exportAlways: ['Height Output'] });
    expect(
      await failure(f.service.buildProject({ mode: 'group', group: '#0', waitSeconds: 60 })),
    ).toMatchObject({
      code: 'REFUSED',
      message:
        "Save the project inside the allowed roots before a group build that writes outputs ('Height Output' has exportAlways set): " +
        `${NEVER_SAVED}.`,
    });
    expect(f.calls).not.toContain('start group #0');
  });
});

describe('GetBuildStatusService (spec v2a section 4)', () => {
  it('reports no build and no preview', async () => {
    const f = exportFakes();
    const service = statusService(f, buildFake(f.calls));
    expect(await service.getBuildStatus({})).toEqual({ build: null, previewRunning: false, session: SAVED });
  });

  it('reports a running build with its elapsed seconds and starter, and a preview', async () => {
    const f = exportFakes();
    vi.setSystemTime(30_900);
    const service = statusService(
      f,
      buildFake(f.calls, { run: { ...RUNNING_FULL, startedBy: 'world-machine' }, previews: [true] }),
    );
    expect(await service.getBuildStatus({})).toEqual({
      build: { mode: 'full', elapsedSeconds: 30, startedBy: 'world-machine' },
      previewRunning: true,
      session: SAVED,
    });
  });

  it('reports a run World Machine started with mode unknown until its kind shows (spec v2a section 3)', async () => {
    const f = exportFakes();
    vi.setSystemTime(4_000);
    const service = statusService(f, buildFake(f.calls, { run: RUNNING_UNKNOWN }));
    expect((await service.getBuildStatus({})).build).toEqual({
      mode: 'unknown',
      elapsedSeconds: 4,
      startedBy: 'world-machine',
    });
  });
});

describe('get_build_status reports the last full build (build-status-check design sections 3-5)', () => {
  const STARTED = '1970-01-01T00:00:00.000Z';
  // Height Output #1 without a result; the default project's other outputs built.
  const NOT_BUILT = {
    outputsBuilt: false,
    notBuilt: [{ id: 1, name: 'Height Output' }],
    stoppedAt: [{ id: 1, name: 'Height Output', type: 'Height Output', enabled: true, bypassed: false }],
    hint: NOT_BUILT_HINT,
  };

  /** A full build that outlived build_project's wait and then ended; `calls` starts empty. */
  async function outlived(results: ResultsFakeOptions = { unbuilt: [1] }) {
    const f = building({ wait: async () => false }, {}, results);
    expect(await f.service.buildProject({ mode: 'full', waitSeconds: 1 })).toEqual({
      state: 'running',
      mode: 'full',
      elapsedSeconds: 0,
      session: SAVED,
    });
    f.port.end();
    f.calls.length = 0;
    return f;
  }

  it('reports nothing while the build runs, checks it once it has ended, and repeats the result without reads', async () => {
    const f = building({ wait: async () => false }, {}, { unbuilt: [1] });
    await f.service.buildProject({ mode: 'full', waitSeconds: 1 });
    expect(await f.status.getBuildStatus({})).toStrictEqual({
      build: { mode: 'full', elapsedSeconds: 0, startedBy: 'server' },
      previewRunning: false,
      session: SAVED,
    });
    f.port.end();
    f.calls.length = 0;
    const view = {
      build: null,
      previewRunning: false,
      lastFullBuild: { startedAt: STARTED, ...NOT_BUILT },
      session: SAVED,
    };
    expect(await f.status.getBuildStatus({})).toStrictEqual(view);
    expect(f.calls).toEqual(['build status', ...OUTPUT_CHECK_CALLS]);
    f.calls.length = 0;
    expect(await f.status.getBuildStatus({})).toStrictEqual(view);
    expect(f.calls).toEqual(['build status']);
  });

  it('reports that the project changed, without reads, after an edit between the end and the check', async () => {
    const f = await outlived();
    f.edit();
    expect((await f.status.getBuildStatus({})).lastFullBuild).toStrictEqual({
      startedAt: STARTED,
      outputsCheckError: PROJECT_CHANGED,
    });
    expect(f.calls).toEqual(['build status']);
  });

  it('reports the results gone, without reads, when the session is not ready', async () => {
    const f = await outlived();
    f.setSession({ state: 'notRunning' });
    expect(await f.status.getBuildStatus({})).toStrictEqual({
      build: null,
      previewRunning: false,
      lastFullBuild: { startedAt: STARTED, outputsCheckError: RESULTS_GONE },
      session: { state: 'notRunning' },
    });
    expect(f.calls).toEqual(['build status']);
  });

  it('reports the results gone, without reads, when the run vanished with World Machine, and keeps a checked result (Revision 2)', async () => {
    const f = await outlived();
    f.port.exit();
    expect((await f.status.getBuildStatus({})).lastFullBuild).toStrictEqual({
      startedAt: STARTED,
      outputsCheckError: RESULTS_GONE,
    });
    expect(f.calls).toEqual(['build status']);
    const g = building({}, {}, { unbuilt: [1] });
    await g.service.buildProject({ mode: 'full', waitSeconds: 60 });
    g.port.exit();
    g.calls.length = 0;
    expect((await g.status.getBuildStatus({})).lastFullBuild).toStrictEqual({
      startedAt: STARTED,
      ...NOT_BUILT,
    });
    expect(g.calls).toEqual(['build status']);
  });

  it('reports the results gone under the new build when its wait failed, not the earlier build\'s result', async () => {
    let crash = false;
    const f = building(
      {
        wait: async () => {
          if (crash) throw new WorldMachineError('CRASHED', 'World Machine exited during the build');
          return true;
        },
      },
      {},
      { unbuilt: [1] },
    );
    await f.service.buildProject({ mode: 'full', waitSeconds: 60 });
    vi.setSystemTime(5_000);
    crash = true;
    const error = await failure(f.service.buildProject({ mode: 'full', waitSeconds: 60 }));
    expect(error.code).toBe('CRASHED');
    f.port.exit();
    f.calls.length = 0;
    expect((await f.status.getBuildStatus({})).lastFullBuild).toStrictEqual({
      startedAt: '1970-01-01T00:00:05.000Z',
      outputsCheckError: RESULTS_GONE,
    });
    expect(f.calls).toEqual(['build status']);
  });

  it('stores a WorldMachineError of the check and repeats it without reads', async () => {
    const f = await outlived({ failure: new WorldMachineError('TIMEOUT', 'World Machine did not answer') });
    const failed = { startedAt: STARTED, outputsCheckError: 'World Machine did not answer' };
    expect((await f.status.getBuildStatus({})).lastFullBuild).toStrictEqual(failed);
    f.calls.length = 0;
    expect((await f.status.getBuildStatus({})).lastFullBuild).toStrictEqual(failed);
    expect(f.calls).toEqual(['build status']);
  });

  it('fails the call on an error that is no WorldMachineError and checks again on the next call (plan decision D11)', async () => {
    const f = await outlived({ failOnce: new Error('a bug') });
    await expect(f.status.getBuildStatus({})).rejects.toThrow('a bug');
    expect((await f.status.getBuildStatus({})).lastFullBuild).toStrictEqual({
      startedAt: STARTED,
      outputsBuilt: true,
      notBuilt: [],
      stoppedAt: [],
    });
    expect(f.calls.filter((call) => call.startsWith('devicetiming'))).toHaveLength(2);
  });

  it('clears the record when a new build starts', async () => {
    const f = await outlived();
    expect((await f.status.getBuildStatus({})).lastFullBuild).toStrictEqual({
      startedAt: STARTED,
      ...NOT_BUILT,
    });
    vi.setSystemTime(5_000);
    await f.service.buildProject({ mode: 'group', group: '#0', waitSeconds: 1 });
    expect(await f.status.getBuildStatus({})).toStrictEqual({
      build: { mode: 'full', elapsedSeconds: 0, startedBy: 'server' },
      previewRunning: false,
      session: SAVED,
    });
    f.port.end();
    f.calls.length = 0;
    expect(await f.status.getBuildStatus({})).toStrictEqual({
      build: null,
      previewRunning: false,
      session: SAVED,
    });
    expect(f.calls).toEqual(['build status']);
  });

  it('repeats a build that finished within the wait without reads', async () => {
    const f = building({}, {}, { unbuilt: [1] });
    expect(await f.service.buildProject({ mode: 'full', waitSeconds: 60 })).toMatchObject(NOT_BUILT);
    f.port.end();
    f.calls.length = 0;
    expect(await f.status.getBuildStatus({})).toStrictEqual({
      build: null,
      previewRunning: false,
      lastFullBuild: { startedAt: STARTED, ...NOT_BUILT },
      session: SAVED,
    });
    expect(f.calls).toEqual(['build status']);
  });

  it('records a full build that ended inside its own start and repeats it without reads (fact 47)', async () => {
    const f = building({}, {}, { unbuilt: [1] });
    // The end arrives in the frame of the start command: current() has no run, last() holds the ended one.
    const start = f.port.start;
    (f.port as { start: typeof start }).start = async (mode, group) => {
      await start(mode, group);
      f.port.end();
    };
    expect(await f.service.buildProject({ mode: 'full', waitSeconds: 60 })).toMatchObject(NOT_BUILT);
    f.calls.length = 0;
    expect(await f.status.getBuildStatus({})).toStrictEqual({
      build: null,
      previewRunning: false,
      lastFullBuild: { startedAt: STARTED, ...NOT_BUILT },
      session: SAVED,
    });
    expect(f.calls).toEqual(['build status']);
  });

  it('leaves the record alone when build_project is cancelled while it queued for exclusive()', async () => {
    const f = building({}, {}, { unbuilt: [1] });
    await f.service.buildProject({ mode: 'full', waitSeconds: 60 });
    f.port.end();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const exclusive = f.session.exclusive;
    const queued: WorldMachineSessionPort = {
      ...f.session,
      exclusive: async (action) => {
        await gate;
        return exclusive(action);
      },
    };
    const service = new BuildProjectService(
      queued,
      f.port,
      f.exports,
      f.graph,
      f.policy,
      groupsFake(f.calls),
      resultsFake(f.calls),
      f.lastFullBuild,
    );
    const abort = new AbortController();
    const view = service.buildProject({ mode: 'full', waitSeconds: 60, signal: abort.signal });
    abort.abort();
    release();
    expect(await view).toEqual({ state: 'running', mode: 'full', elapsedSeconds: 0, session: SAVED });
    expect((await f.status.getBuildStatus({})).lastFullBuild).toStrictEqual({
      startedAt: STARTED,
      ...NOT_BUILT,
    });
  });

  it('omits the result of a check refused because a build started meanwhile, and clears it on the next call', async () => {
    const f = await outlived();
    const starting: WorldMachineSessionPort = {
      ...f.session,
      exclusive: async () => {
        vi.setSystemTime(5_000);
        await f.port.start('full');
        throw new WorldMachineError(
          'REFUSED',
          'A build is running; call stop_build or wait for it to finish',
        );
      },
    };
    const status = new GetBuildStatusService(
      starting,
      f.port,
      f.lastFullBuild,
      new OutputsChecker(starting, f.exports, f.graph, resultsFake(f.calls)),
    );
    expect(await status.getBuildStatus({})).toStrictEqual({
      build: { mode: 'full', elapsedSeconds: 0, startedBy: 'server' },
      previewRunning: false,
      session: SAVED,
    });
    f.port.end();
    f.calls.length = 0;
    expect(await f.status.getBuildStatus({})).toStrictEqual({
      build: null,
      previewRunning: false,
      session: SAVED,
    });
    expect(f.calls).toEqual(['build status']);
  });

  it("reports that the project changed when an edit ran before the check's exclusive() section (plan decision D7)", async () => {
    const f = await outlived();
    const edited: WorldMachineSessionPort = {
      ...f.session,
      exclusive: (action) => {
        f.edit();
        return f.session.exclusive(action);
      },
    };
    const status = new GetBuildStatusService(
      edited,
      f.port,
      f.lastFullBuild,
      new OutputsChecker(edited, f.exports, f.graph, resultsFake(f.calls)),
    );
    expect((await status.getBuildStatus({})).lastFullBuild).toStrictEqual({
      startedAt: STARTED,
      outputsCheckError: PROJECT_CHANGED,
    });
    expect(f.calls).toEqual(['build status', 'exclusive', 'exclusive end']);
  });

  it("clears the record, reading nothing, when an open or create ran before the check's exclusive() section (plan decision D7)", async () => {
    const f = await outlived();
    const switched: WorldMachineSessionPort = {
      ...f.session,
      exclusive: (action) => {
        f.switchProject();
        return f.session.exclusive(action);
      },
    };
    const status = new GetBuildStatusService(
      switched,
      f.port,
      f.lastFullBuild,
      new OutputsChecker(switched, f.exports, f.graph, resultsFake(f.calls)),
    );
    expect(await status.getBuildStatus({})).toStrictEqual({
      build: null,
      previewRunning: false,
      session: SAVED,
    });
    expect(f.calls).toEqual(['build status', 'exclusive', 'exclusive end']);
    f.calls.length = 0;
    expect(await f.status.getBuildStatus({})).toStrictEqual({
      build: null,
      previewRunning: false,
      session: SAVED,
    });
    expect(f.calls).toEqual(['build status']);
  });

  it('clears the record, reading nothing, when a window build started and ended while the check queued (Codex round 2 ruling 1a)', async () => {
    const f = await outlived();
    // buildFake opens a server run; the record needs only another run that ended before the check's section.
    const window: WorldMachineSessionPort = {
      ...f.session,
      exclusive: async (action) => {
        vi.setSystemTime(5_000);
        await f.port.start('full');
        f.port.end();
        return f.session.exclusive(action);
      },
    };
    const status = new GetBuildStatusService(
      window,
      f.port,
      f.lastFullBuild,
      new OutputsChecker(window, f.exports, f.graph, resultsFake(f.calls)),
    );
    expect(await status.getBuildStatus({})).toStrictEqual({
      build: null,
      previewRunning: false,
      session: SAVED,
    });
    expect(f.calls).toEqual(['build status', 'start full', 'exclusive', 'exclusive end']);
    f.calls.length = 0;
    expect(await f.status.getBuildStatus({})).toStrictEqual({
      build: null,
      previewRunning: false,
      session: SAVED,
    });
    expect(f.calls).toEqual(['build status']);
  });

  it('reports the results gone, reading nothing, when World Machine was relaunched while the check queued (Codex round 2 ruling 1a)', async () => {
    const f = await outlived();
    const relaunched: WorldMachineSessionPort = {
      ...f.session,
      exclusive: (action) => {
        f.port.exit();
        f.relaunch();
        return f.session.exclusive(action);
      },
    };
    const status = new GetBuildStatusService(
      relaunched,
      f.port,
      f.lastFullBuild,
      new OutputsChecker(relaunched, f.exports, f.graph, resultsFake(f.calls)),
    );
    expect((await status.getBuildStatus({})).lastFullBuild).toStrictEqual({
      startedAt: STARTED,
      outputsCheckError: RESULTS_GONE,
    });
    expect(f.calls).toEqual(['build status', 'exclusive', 'exclusive end']);
  });

  it('stores nothing for a check refused because a build runs, so a later World Machine exit reports the results gone (Codex round 2 ruling 1b)', async () => {
    const f = await outlived();
    const refusing: WorldMachineSessionPort = {
      ...f.session,
      exclusive: async () => {
        throw new WorldMachineError(
          'REFUSED',
          'A build is running; call stop_build or wait for it to finish',
        );
      },
    };
    const status = new GetBuildStatusService(
      refusing,
      f.port,
      f.lastFullBuild,
      new OutputsChecker(refusing, f.exports, f.graph, resultsFake(f.calls)),
    );
    expect(await status.getBuildStatus({})).toStrictEqual({
      build: null,
      previewRunning: false,
      session: SAVED,
    });
    f.port.exit();
    f.calls.length = 0;
    expect((await f.status.getBuildStatus({})).lastFullBuild).toStrictEqual({
      startedAt: STARTED,
      outputsCheckError: RESULTS_GONE,
    });
    expect(f.calls).toEqual(['build status']);
  });
});

describe('StopBuildService (spec v2a section 4)', () => {
  function stopping(options: BuildFakeOptions) {
    const f = exportFakes();
    return { ...f, service: new StopBuildService(f.session, buildFake(f.calls, options)) };
  }

  it('stops a running full or tiled build and waits up to 10 s for its end, outside exclusive()', async () => {
    const f = stopping({ run: { ...RUNNING_FULL, mode: 'tiled' } });
    expect(await f.service.stopBuild({})).toEqual({ stopped: 'tiled', session: SAVED });
    expect(f.calls).toEqual(['build stop', 'wait tiled 10000']);
  });

  it('fails with WM_COMMAND_FAILED when the run does not end within 10 s, and keeps a server run', async () => {
    const f = stopping({ run: RUNNING_FULL, wait: async () => false });
    expect(await failure(f.service.stopBuild({}))).toMatchObject({
      code: 'WM_COMMAND_FAILED',
      message: 'The full build did not end within 10 s of build stop',
    });
    expect(f.calls).toEqual(['build stop', 'wait full 10000']);
  });

  it('drops a run World Machine started that shows no end within 10 s, and still fails with WM_COMMAND_FAILED', async () => {
    const f = stopping({ run: RUNNING_UNKNOWN, wait: async () => false });
    expect(await failure(f.service.stopBuild({}))).toMatchObject({
      code: 'WM_COMMAND_FAILED',
      message:
        'The build started in World Machine did not end within 10 s of build stop; the server no longer tracks it',
    });
    expect(f.calls).toEqual(['build stop', 'wait unknown 10000', 'forget']);
    expect(await f.service.stopBuild({})).toEqual({ stopped: null, session: SAVED });
  });

  it('stops a running preview and reads the status back (fact 46)', async () => {
    const f = stopping({ previews: [true, false] });
    expect(await f.service.stopBuild({})).toEqual({ stopped: 'preview', session: SAVED });
    expect(f.calls).toEqual(['build status', 'build stop', 'build status']);
  });

  it('fails with WM_COMMAND_FAILED when the preview still runs after the stop (decision D7)', async () => {
    const f = stopping({ previews: [true] });
    expect((await failure(f.service.stopBuild({}))).code).toBe('WM_COMMAND_FAILED');
  });

  it('sends no build stop when nothing runs', async () => {
    const f = stopping({});
    expect(await f.service.stopBuild({})).toEqual({ stopped: null, session: SAVED });
    expect(f.calls).toEqual(['build status']);
  });
});

// raw/build-not-built-timing.txt l.1-46: Gradient into River into File Output.
const RIVER_DEVICES: readonly DeviceSummary[] = [
  { id: 1, name: 'Gradient', enabled: true, bypassed: false },
  { id: 2, name: 'River', enabled: true, bypassed: false },
  { id: 3, name: 'Height Output', enabled: true, bypassed: false },
];
const RIVER_DETAILS: readonly DeviceDetail[] = [
  detailOf(3, 'Height Output', 'Height Output', [
    { port: 1, name: 'Primary Input', source: { device: 'River', port: 1 } },
  ]),
  detailOf(2, 'River', 'River', [
    { port: 1, name: 'Terrain Input', source: { device: 'Gradient', port: 1 } },
    { port: 2, name: 'River Parameters' },
  ]),
  detailOf(1, 'Gradient', 'Gradient'),
];
const RIVER_TARGETS = [{ device: 'Height Output', template: '<WORK>/river-height.png' }];
/** The River graph; by default the River and its output have no result (fact 93). */
const river = (results: ResultsFakeOptions = { unbuilt: [2, 3] }) =>
  building({}, { targets: RIVER_TARGETS, devices: RIVER_DEVICES, details: RIVER_DETAILS }, results);

describe('BuildProjectService output check (build-not-built design sections 3-6)', () => {
  it('reports the output a River did not build and the River where building stopped (fact 93)', async () => {
    const f = river();
    expect(await f.service.buildProject({ mode: 'full', waitSeconds: 60 })).toEqual({
      state: 'finished',
      mode: 'full',
      elapsedSeconds: 0,
      outputsBuilt: false,
      notBuilt: [{ id: 3, name: 'Height Output' }],
      stoppedAt: [{ id: 2, name: 'River', type: 'River', enabled: true, bypassed: false }],
      hint: NOT_BUILT_HINT,
      session: SAVED,
    });
    expect(f.calls.slice(f.calls.indexOf('wait full 60000') + 1)).toEqual([
      'exclusive',
      'export list',
      'device list',
      'devicetiming #1, #2, #3',
      'device info #3',
      'device info #2',
      'device info #1',
      'exclusive end',
    ]);
  });

  it('times every listed device before any device is read, since a read selects the device (section 4 step 2)', async () => {
    const f = building({}, { targets: RIVER_TARGETS, devices: RIVER_DEVICES, details: [] }, {});
    await f.service.buildProject({ mode: 'full', waitSeconds: 60 });
    const timing = f.calls.findIndex((call) => call.startsWith('devicetiming'));
    const firstRead = f.calls.findIndex((call) => call.startsWith('device info'));
    expect(timing).toBeGreaterThan(-1);
    expect(firstRead).toBeGreaterThan(timing);
  });

  it('reports every output built, without a hint, when every device has a result', async () => {
    expect(await river({}).service.buildProject({ mode: 'full', waitSeconds: 60 })).toEqual({
      state: 'finished',
      mode: 'full',
      elapsedSeconds: 0,
      outputsBuilt: true,
      notBuilt: [],
      stoppedAt: [],
      session: SAVED,
    });
  });

  it('ends the check after export list when no output is configured (section 4 step 1, plan decision B12)', async () => {
    const f = building({}, { targets: [] });
    expect(await f.service.buildProject({ mode: 'full', waitSeconds: 60 })).toMatchObject({
      state: 'finished',
      outputsBuilt: true,
      notBuilt: [],
      stoppedAt: [],
    });
    expect(f.calls).toEqual([
      'exclusive',
      'export list',
      'start full',
      'exclusive end',
      'wait full 60000',
      'exclusive',
      'export list',
      'exclusive end',
    ]);
  });

  it.each([
    [{ mode: 'preview' as const }],
    [{ mode: 'tiled' as const }],
    [{ mode: 'group' as const, group: '#0' }],
  ])('checks no outputs after a finished build of %j (section 3)', async (input) => {
    const f = building();
    const view = await f.service.buildProject({ ...input, waitSeconds: 60 });
    expect(view.state).toBe('finished');
    for (const field of ['outputsBuilt', 'notBuilt', 'stoppedAt', 'hint', 'outputsCheckError']) {
      expect(view).not.toHaveProperty(field);
    }
    expect(f.calls.some((call) => call.startsWith('devicetiming') || call === 'device list')).toBe(false);
    expect(f.calls.at(-1)).toMatch(/^wait /);
  });

  it('checks no outputs when the wait ends first (section 3)', async () => {
    const f = building(
      { wait: async () => false },
      { targets: RIVER_TARGETS, devices: RIVER_DEVICES, details: RIVER_DETAILS },
    );
    expect(await f.service.buildProject({ mode: 'full', waitSeconds: 0 })).toEqual({
      state: 'running',
      mode: 'full',
      elapsedSeconds: 0,
      session: SAVED,
    });
    expect(f.calls.at(-1)).toBe('wait full 0');
  });

  it('keeps the build finished and reports why when the results cannot be read (section 6)', async () => {
    const message =
      'Could not parse World Machine output for debug devicetiming #3. This World Machine build may format it differently.';
    const f = river({ failure: new WorldMachineError('UNEXPECTED_OUTPUT', message) });
    expect(await f.service.buildProject({ mode: 'full', waitSeconds: 60 })).toEqual({
      state: 'finished',
      mode: 'full',
      elapsedSeconds: 0,
      outputsCheckError: message,
      session: SAVED,
    });
    expect(f.calls.at(-1)).toBe('exclusive end');
  });

  it('keeps the build finished and reports why when a device cannot be read (section 6)', async () => {
    const f = building({}, { targets: RIVER_TARGETS, devices: RIVER_DEVICES, details: [] });
    expect(await f.service.buildProject({ mode: 'full', waitSeconds: 60 })).toEqual({
      state: 'finished',
      mode: 'full',
      elapsedSeconds: 0,
      outputsCheckError: 'World Machine rejected "device select #3"',
      session: SAVED,
    });
  });

  it('keeps the build finished when the check is refused its exclusive() action (Review Focus 4, plan decision B1)', async () => {
    const f = river();
    const exclusive = f.session.exclusive;
    let entries = 0;
    const refusing: typeof f.session = {
      ...f.session,
      exclusive: async (action) => {
        entries++;
        if (entries === 2) {
          throw new WorldMachineError(
            'REFUSED',
            'A build is running; call stop_build or wait for it to finish',
          );
        }
        return exclusive(action);
      },
    };
    const service = new BuildProjectService(
      refusing,
      buildFake(f.calls),
      f.exports,
      f.graph,
      f.policy,
      groupsFake(f.calls),
      resultsFake(f.calls),
      new LastFullBuildRecord(),
    );
    expect(await service.buildProject({ mode: 'full', waitSeconds: 60 })).toEqual({
      state: 'finished',
      mode: 'full',
      elapsedSeconds: 0,
      outputsCheckError: 'A build is running; call stop_build or wait for it to finish',
      session: SAVED,
    });
  });

  it('lets an error that is no WorldMachineError propagate (plan decision B9)', async () => {
    await expect(
      river({ failure: new Error('a bug') }).service.buildProject({ mode: 'full', waitSeconds: 60 }),
    ).rejects.toThrow('a bug');
  });

  it('reports the seconds of the build, not of the check (plan decision B8)', async () => {
    const f = building();
    const slow: BuildResultPort = {
      builtDevices: async (ids) => {
        vi.setSystemTime(40_000);
        return [...ids];
      },
    };
    const wait = async () => {
      vi.setSystemTime(12_500);
      return true;
    };
    const service = new BuildProjectService(
      f.session,
      buildFake(f.calls, { wait }),
      f.exports,
      f.graph,
      f.policy,
      groupsFake(f.calls),
      slow,
      new LastFullBuildRecord(),
    );
    expect((await service.buildProject({ mode: 'full', waitSeconds: 60 })).elapsedSeconds).toBe(12);
  });
});
