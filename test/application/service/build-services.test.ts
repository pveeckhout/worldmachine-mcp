import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BuildPort } from '../../../src/application/port/out/build-port.js';
import type { GroupPort } from '../../../src/application/port/out/group-port.js';
import { BuildProjectService } from '../../../src/application/service/build-project-service.js';
import { NEVER_SAVED } from '../../../src/application/service/export-rules.js';
import { GetBuildStatusService } from '../../../src/application/service/get-build-status-service.js';
import { StopBuildService } from '../../../src/application/service/stop-build-service.js';
import type { BuildMode, BuildRun, RunMode } from '../../../src/domain/build.js';
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

/** A BuildPort that records its calls into `calls`, as `exportFakes` does. */
function buildFake(calls: string[], options: BuildFakeOptions = {}): BuildPort {
  let run = options.run;
  const previews = [...(options.previews ?? [false])];
  return {
    current: () => run,
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

function building(build: BuildFakeOptions = {}, ports: ExportFakeOptions = {}) {
  const f = exportFakes(ports);
  const port = buildFake(f.calls, build);
  return {
    ...f,
    service: new BuildProjectService(f.session, port, f.exports, f.graph, f.policy, groupsFake(f.calls)),
  };
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
      session: SAVED,
    });
    expect(f.calls).toEqual([
      'exclusive',
      'export list',
      'exportAlways Height Output, Material Output, Colormap only, Splatmap',
      'start full',
      'exclusive end',
      'wait full 60000',
    ]);
  });

  it('checks every export target before a full build when a File Output has exportAlways set (fact 55)', async () => {
    const f = building({}, { exportAlways: ['Height Output'] });
    expect(await f.service.buildProject({ mode: 'full', waitSeconds: 60 })).toEqual({
      state: 'finished',
      mode: 'full',
      elapsedSeconds: 0,
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
    const service = new BuildProjectService(f.session, buildFake(f.calls), f.exports, f.graph, f.policy, {
      ...groups,
      resolve: async () => extended,
    });
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
    const service = new GetBuildStatusService(f.session, buildFake(f.calls));
    expect(await service.getBuildStatus({})).toEqual({ build: null, previewRunning: false, session: SAVED });
  });

  it('reports a running build with its elapsed seconds and starter, and a preview', async () => {
    const f = exportFakes();
    vi.setSystemTime(30_900);
    const service = new GetBuildStatusService(
      f.session,
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
    const service = new GetBuildStatusService(f.session, buildFake(f.calls, { run: RUNNING_UNKNOWN }));
    expect((await service.getBuildStatus({})).build).toEqual({
      mode: 'unknown',
      elapsedSeconds: 4,
      startedBy: 'world-machine',
    });
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
