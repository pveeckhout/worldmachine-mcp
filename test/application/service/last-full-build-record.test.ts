import { describe, expect, it, vi } from 'vitest';
import {
  type AwaitingFullBuild,
  type BuildObservation,
  type CheckedFullBuild,
  type GuardedCheck,
  type LastFullBuild,
  LastFullBuildRecord,
  type LastFullBuildStep,
  nextLastFullBuildStep,
  PROJECT_CHANGED,
  RESULTS_GONE,
  type StopStep,
} from '../../../src/application/service/last-full-build-record.js';
import type {
  GuardedOutcome,
  OutputsCheckOutcome,
} from '../../../src/application/service/outputs-checker.js';
import type { BuildRun } from '../../../src/domain/build.js';

const RUNNING: BuildRun = { mode: 'full', startedAt: 1_000, startedBy: 'server', state: 'running' };
const ENDED: BuildRun = { ...RUNNING, state: 'ended' };
const STAMP = { startedAt: 1_000, generation: 1, revision: 4, switches: 1 };
const AWAITING: AwaitingFullBuild = { ...STAMP, state: 'awaiting' };
const BUILT: OutputsCheckOutcome = { outputsBuilt: true, notBuilt: [], stoppedAt: [] };
const CHECKED: CheckedFullBuild = { ...STAMP, state: 'checked', result: BUILT };
const seen = (change: Partial<BuildObservation> = {}): BuildObservation => ({
  last: ENDED,
  generation: 1,
  revision: 4,
  switches: 1,
  ready: true,
  ...change,
});
const skip = (outputsCheckError: string): LastFullBuildStep => ({
  kind: 'skip',
  entry: AWAITING,
  outputsCheckError,
});

/** Observations in turn: the first is resolve()'s, the next the guard's inside the section; the last one repeats. */
const observing = (...observations: BuildObservation[]) => {
  const queue = [...observations];
  return () => (queue.length > 1 ? queue.shift() : queue[0]) ?? seen();
};

/** A guarded check that runs the guard as OutputsChecker.checkGuarded does and reads `outcome` when it may. */
const guarded = (outcome: OutputsCheckOutcome = BUILT) =>
  vi.fn<GuardedCheck>(async (guard): Promise<GuardedOutcome<StopStep>> => {
    const stop = guard();
    return stop === undefined ? { kind: 'checked', outcome } : { kind: 'stopped', value: stop };
  });

describe('nextLastFullBuildStep (build-status-check design section 3)', () => {
  it.each<[string, LastFullBuild | undefined, BuildObservation, LastFullBuildStep]>([
    [
      'checks a build that ended, revision unchanged, session ready',
      AWAITING,
      seen(),
      { kind: 'check', entry: AWAITING },
    ],
    ['waits while the build runs', AWAITING, seen({ last: RUNNING }), { kind: 'keep' }],
    ['skips the check after an edit', AWAITING, seen({ revision: 5 }), skip(PROJECT_CHANGED)],
    ['skips the check when the session is not ready', AWAITING, seen({ ready: false }), skip(RESULTS_GONE)],
    [
      'reports the results gone before the change (plan decision D8)',
      AWAITING,
      seen({ ready: false, revision: 5 }),
      skip(RESULTS_GONE),
    ],
    [
      'reports the results gone when the run vanished with World Machine (Revision 2)',
      AWAITING,
      seen({ last: undefined }),
      skip(RESULTS_GONE),
    ],
    [
      'reports the results gone for a vanished run before the change (plan decision D8)',
      AWAITING,
      seen({ last: undefined, revision: 5 }),
      skip(RESULTS_GONE),
    ],
    [
      'reports the results gone in a relaunched process without a run (Codex round 2 ruling 1a)',
      AWAITING,
      seen({ last: undefined, generation: 2 }),
      skip(RESULTS_GONE),
    ],
    [
      'clears after a bind() to another project even when the run vanished (plan decision D8)',
      AWAITING,
      seen({ last: undefined, revision: 5, switches: 2 }),
      { kind: 'clear' },
    ],
    [
      'clears when another run is the last',
      AWAITING,
      seen({ last: { ...ENDED, startedAt: 2_000 } }),
      { kind: 'clear' },
    ],
    [
      "clears for a run of another process, even with the record's startedAt (Codex round 2 ruling 1a)",
      AWAITING,
      seen({ generation: 2 }),
      { kind: 'clear' },
    ],
    [
      'clears after a bind() to another project (plan decision D2)',
      AWAITING,
      seen({ revision: 5, switches: 2 }),
      { kind: 'clear' },
    ],
    [
      'clears a checked result when a new run starts',
      CHECKED,
      seen({ last: { ...RUNNING, startedAt: 2_000 } }),
      { kind: 'clear' },
    ],
    [
      'clears a checked result for a run of another process',
      CHECKED,
      seen({ generation: 2 }),
      { kind: 'clear' },
    ],
    [
      'clears a checked result after a bind() to another project',
      CHECKED,
      seen({ revision: 5, switches: 2 }),
      { kind: 'clear' },
    ],
    ['keeps a checked result after an edit', CHECKED, seen({ revision: 9 }), { kind: 'keep' }],
    [
      'keeps a checked result when the session is not ready',
      CHECKED,
      seen({ ready: false }),
      { kind: 'keep' },
    ],
    [
      'keeps a checked result when its run vanished with World Machine (Revision 2)',
      CHECKED,
      seen({ last: undefined }),
      { kind: 'keep' },
    ],
    [
      'keeps a checked result in a relaunched process without a run (Revision 2)',
      CHECKED,
      seen({ last: undefined, generation: 2 }),
      { kind: 'keep' },
    ],
    [
      'keeps a checked result when nothing changed, so later calls repeat it (design section 3)',
      CHECKED,
      seen(),
      { kind: 'keep' },
    ],
    ['keeps a running check', { ...AWAITING, state: 'checking' }, seen(), { kind: 'keep' }],
    ['keeps nothing without a record', undefined, seen(), { kind: 'keep' }],
  ])('%s', (_, entry, observed, step) => {
    expect(nextLastFullBuildStep(entry, observed)).toEqual(step);
  });
});

describe('LastFullBuildRecord (build-status-check design sections 3 and 4)', () => {
  it('repeats a build that finished within the wait without checking', async () => {
    const record = new LastFullBuildRecord();
    const check = guarded();
    record.finished(STAMP, BUILT);
    expect(await record.resolve(observing(seen()), check)).toEqual(CHECKED);
    expect(check).not.toHaveBeenCalled();
  });

  it('checks an outlived build once it has ended and repeats the result', async () => {
    const record = new LastFullBuildRecord();
    const check = guarded();
    record.outlived(STAMP);
    expect(await record.resolve(observing(seen({ last: RUNNING })), check)).toBeUndefined();
    expect(await record.resolve(observing(seen()), check)).toEqual(CHECKED);
    expect(await record.resolve(observing(seen({ revision: 9 })), check)).toEqual(CHECKED);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('stores why a due check reads nothing, without checking', async () => {
    const record = new LastFullBuildRecord();
    const check = guarded();
    record.outlived(STAMP);
    const changed: CheckedFullBuild = { ...CHECKED, result: { outputsCheckError: PROJECT_CHANGED } };
    expect(await record.resolve(observing(seen({ revision: 5 })), check)).toEqual(changed);
    expect(await record.resolve(observing(seen({ revision: 5 })), check)).toEqual(changed);
    expect(check).not.toHaveBeenCalled();
  });

  it('clears the record for another run', async () => {
    const record = new LastFullBuildRecord();
    const check = guarded();
    record.finished(STAMP, BUILT);
    expect(
      await record.resolve(observing(seen({ last: { ...ENDED, startedAt: 2_000 } })), check),
    ).toBeUndefined();
    expect(await record.resolve(observing(seen()), check)).toBeUndefined();
  });

  it.each<[string, BuildObservation, CheckedFullBuild | undefined]>([
    [
      'clears for a project switch queued ahead of the check (plan decision D7)',
      seen({ revision: 5, switches: 2 }),
      undefined,
    ],
    [
      'clears for a window build that started and ended while the check queued (Codex round 2 ruling 1a)',
      seen({ last: { ...ENDED, startedAt: 2_000, startedBy: 'world-machine' } }),
      undefined,
    ],
    [
      'stores the change for an edit queued ahead of the check (plan decision D7)',
      seen({ revision: 5 }),
      { ...CHECKED, result: { outputsCheckError: PROJECT_CHANGED } },
    ],
    [
      'stores the results gone for a relaunch queued ahead of the check (Codex round 2 ruling 1a)',
      seen({ last: undefined, generation: 2 }),
      { ...CHECKED, result: { outputsCheckError: RESULTS_GONE } },
    ],
  ])('re-runs the step inside the section and %s', async (_, inside, result) => {
    const record = new LastFullBuildRecord();
    const check = guarded();
    record.outlived(STAMP);
    expect(await record.resolve(observing(seen(), inside), check)).toEqual(result);
    expect(await record.resolve(observing(inside), guarded())).toEqual(result);
  });

  it('shares one check between two concurrent calls', async () => {
    const record = new LastFullBuildRecord();
    let finish: () => void = () => undefined;
    const check = vi.fn<GuardedCheck>(
      (guard) =>
        new Promise<GuardedOutcome<StopStep>>((resolve) => {
          finish = () => {
            const stop = guard();
            resolve(
              stop === undefined ? { kind: 'checked', outcome: BUILT } : { kind: 'stopped', value: stop },
            );
          };
        }),
    );
    record.outlived(STAMP);
    const first = record.resolve(observing(seen()), check);
    const second = record.resolve(observing(seen()), check);
    finish();
    expect(await Promise.all([first, second])).toEqual([CHECKED, CHECKED]);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('fails both calls on an error that is no WorldMachineError, and checks again on the next call (plan decision D11)', async () => {
    const record = new LastFullBuildRecord();
    const check = vi
      .fn<GuardedCheck>()
      .mockRejectedValueOnce(new Error('a bug'))
      .mockImplementation(guarded());
    record.outlived(STAMP);
    const settled = await Promise.allSettled([
      record.resolve(observing(seen()), check),
      record.resolve(observing(seen()), check),
    ]);
    expect(settled.map((outcome) => outcome.status)).toEqual(['rejected', 'rejected']);
    expect(await record.resolve(observing(seen()), check)).toEqual(CHECKED);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('stores nothing for a refused exclusive() section, so a later exit reports the results gone (Codex round 2 ruling 1b)', async () => {
    const record = new LastFullBuildRecord();
    const refused = vi.fn<GuardedCheck>(async () => ({ kind: 'refused' }));
    record.outlived(STAMP);
    expect(await record.resolve(observing(seen()), refused)).toBeUndefined();
    const check = guarded();
    expect(await record.resolve(observing(seen({ last: undefined })), check)).toEqual({
      ...CHECKED,
      result: { outputsCheckError: RESULTS_GONE },
    });
    expect(check).not.toHaveBeenCalled();
  });

  it('keeps what build_project wrote while a check ran (plan decision D10)', async () => {
    const record = new LastFullBuildRecord();
    let finish: () => void = () => undefined;
    const slow = vi.fn<GuardedCheck>(
      () =>
        new Promise<GuardedOutcome<StopStep>>((resolve) => {
          finish = () => resolve({ kind: 'checked', outcome: BUILT });
        }),
    );
    record.outlived(STAMP);
    const pending = record.resolve(observing(seen()), slow);
    const newer = { startedAt: 2_000, generation: 1, revision: 6, switches: 1 };
    record.outlived(newer);
    finish();
    expect(await pending).toBeUndefined();
    const check = guarded();
    const next = seen({ last: { ...ENDED, startedAt: 2_000 }, revision: 6 });
    expect(await record.resolve(observing(next), check)).toEqual({
      ...newer,
      state: 'checked',
      result: BUILT,
    });
    expect(check).toHaveBeenCalledTimes(1);
  });
});
