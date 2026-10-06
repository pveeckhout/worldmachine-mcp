import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseBuildEvent } from '../../../../src/adapter/out/worldmachine/build-events.js';
import { BuildTracker, LATE_START_MS } from '../../../../src/adapter/out/worldmachine/build-tracker.js';
import { fixtureLines } from './parsers/fixture.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.useRealTimers();
});

/** A tracker with a running full run that the server started at time 1000. */
function runningFull(): BuildTracker {
  const tracker = new BuildTracker();
  tracker.expect('full');
  vi.setSystemTime(1_000);
  tracker.apply('sleep-prohibited');
  tracker.apply('starting');
  return tracker;
}

describe('BuildTracker (spec v2a section 5)', () => {
  it('confirms a server full start and resolves ended() when the run ends', async () => {
    const tracker = new BuildTracker();
    tracker.expect('full');
    const started = tracker.started(5_000);
    vi.setSystemTime(1_000);
    tracker.apply('sleep-prohibited');
    tracker.apply('starting');
    await expect(started).resolves.toBe(true);
    expect(tracker.running).toBe(true);
    expect(tracker.snapshot()).toEqual({
      mode: 'full',
      startedAt: 1_000,
      startedBy: 'server',
      state: 'running',
    });
    const ended = tracker.ended(60_000);
    tracker.apply('ended');
    tracker.apply('build-started');
    await expect(ended).resolves.toBe(true);
    expect(tracker.snapshot()?.state).toBe('ended');
  });

  it('confirms a server tiled start on sleep-prohibited and ends it on sleep-allowed (fact 48)', async () => {
    const tracker = new BuildTracker();
    tracker.expect('tiled');
    tracker.apply('sleep-prohibited');
    await expect(tracker.started(5_000)).resolves.toBe(true);
    expect(tracker.snapshot()).toMatchObject({ mode: 'tiled', startedBy: 'server', state: 'running' });
    tracker.apply('sleep-allowed');
    expect(tracker.running).toBe(false);
  });

  it('exposes the pending start until its opening event arrives or it is cancelled', async () => {
    const tracker = new BuildTracker();
    expect(tracker.pending).toBeUndefined();
    tracker.expect('full');
    expect(tracker.pending).toBe('full');
    const started = tracker.started(5_000);
    tracker.apply('starting');
    await expect(started).resolves.toBe(true);
    expect(tracker.pending).toBeUndefined();
    tracker.expect('tiled');
    tracker.cancelExpectation();
    expect(tracker.pending).toBeUndefined();
  });

  it('keeps a tiled run running across the late trailer of the full run before it (raw/v2-build-long.txt l.57-67)', () => {
    const tracker = runningFull();
    tracker.apply('ended');
    tracker.expect('tiled');
    tracker.apply('sleep-prohibited');
    tracker.apply('sleep-allowed');
    expect(tracker.snapshot()).toMatchObject({ mode: 'tiled', state: 'running' });
    tracker.apply('sleep-allowed');
    expect(tracker.running).toBe(false);
  });

  it('resolves started() with false when no start event arrives in time', async () => {
    const tracker = new BuildTracker();
    tracker.expect('full');
    const started = tracker.started(5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(started).resolves.toBe(false);
  });

  it('records a run started in the World Machine window (assumption A1)', () => {
    const tracker = new BuildTracker();
    tracker.apply('starting');
    expect(tracker.snapshot()).toMatchObject({ mode: 'full', startedBy: 'world-machine', state: 'running' });
  });

  it('runs a tiled build from the World Machine window as a provisional run until sleep-allowed (spec v2a section 3)', () => {
    const tracker = new BuildTracker();
    let ends = 0;
    tracker.onEnd(() => ends++);
    vi.setSystemTime(2_000);
    tracker.apply('sleep-prohibited');
    expect(tracker.running).toBe(true);
    expect(tracker.snapshot()).toEqual({
      mode: 'unknown',
      startedAt: 2_000,
      startedBy: 'world-machine',
      state: 'running',
    });
    tracker.apply('sleep-allowed');
    expect(tracker.running).toBe(false);
    expect(tracker.snapshot()).toMatchObject({ mode: 'unknown', state: 'ended' });
    expect(ends).toBe(1);
  });

  it('promotes a provisional run to full on starting (spec v2a section 3)', () => {
    const tracker = new BuildTracker();
    tracker.apply('sleep-prohibited');
    tracker.apply('starting');
    expect(tracker.snapshot()).toMatchObject({ mode: 'full', startedBy: 'world-machine', state: 'running' });
  });

  it('keeps a window restart running across the owed trailer of the run it replaced (raw/v2-build-long.txt l.56-68)', async () => {
    const tracker = new BuildTracker();
    tracker.apply('sleep-prohibited');
    tracker.apply('starting');
    for (const event of ['ended', 'sleep-prohibited', 'starting', 'sleep-allowed'] as const) {
      tracker.apply(event);
    }
    expect(tracker.snapshot()).toMatchObject({ mode: 'full', startedBy: 'world-machine', state: 'running' });
    tracker.apply('ended');
    tracker.apply('sleep-allowed');
    // The capture shows no `Build started.` for either run, so the run ends at the late-line bound (spec section 3).
    expect(tracker.running).toBe(true);
    await vi.advanceTimersByTimeAsync(LATE_START_MS);
    expect(tracker.running).toBe(false);
    expect(tracker.snapshot()).toMatchObject({ mode: 'full', state: 'ended' });
  });

  it('forgets a running run on request, resolving its waiters and calling the end listeners', async () => {
    const tracker = new BuildTracker();
    let ends = 0;
    tracker.onEnd(() => ends++);
    tracker.apply('sleep-prohibited');
    const ended = tracker.ended(600_000);
    tracker.forget();
    await expect(ended).resolves.toBe(true);
    expect(tracker.running).toBe(false);
    expect(tracker.snapshot()).toBeUndefined();
    expect(ends).toBe(1);
    tracker.forget();
    expect(ends).toBe(1);
  });

  it('waits for the pending start without a bound when started() gets no ms', async () => {
    const tracker = new BuildTracker();
    tracker.expect('full');
    let settled = false;
    const started = tracker.started().then((result) => {
      settled = true;
      return result;
    });
    await vi.advanceTimersByTimeAsync(600_000);
    expect(settled).toBe(false);
    tracker.cancelExpectation();
    await expect(started).resolves.toBe(true);
  });

  it('resolves ended() at once without a running run', async () => {
    await expect(new BuildTracker().ended(10)).resolves.toBe(true);
  });

  it('resolves ended() with false at its bound and keeps the run', async () => {
    const tracker = runningFull();
    const ended = tracker.ended(10_000);
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(ended).resolves.toBe(false);
    expect(tracker.running).toBe(true);
  });

  it('resolves ended() with false when its signal aborts', async () => {
    const tracker = runningFull();
    const abort = new AbortController();
    const ended = tracker.ended(600_000, abort.signal);
    abort.abort();
    await expect(ended).resolves.toBe(false);
    expect(tracker.running).toBe(true);
  });

  it('fails waiters with CRASHED and forgets the run when the process exits', async () => {
    const tracker = runningFull();
    const ended = tracker.ended(600_000);
    expect(tracker.dropped).toBe(false);
    tracker.drop();
    expect(tracker.dropped).toBe(true);
    await expect(ended).rejects.toMatchObject({
      code: 'CRASHED',
      message: 'World Machine exited during the build',
    });
    expect(tracker.running).toBe(false);
    expect(tracker.snapshot()).toBeUndefined();
    await expect(tracker.ended(10)).rejects.toMatchObject({ code: 'CRASHED' });
    tracker.apply('starting');
    expect(tracker.running).toBe(false);
  });

  it('leaves nothing behind when the process exits: no run, no pending start, no owed trailer', () => {
    const tracker = runningFull();
    tracker.apply('ended');
    tracker.expect('tiled');
    expect(tracker.pending).toBe('tiled');
    tracker.drop();
    expect(tracker.snapshot()).toBeUndefined();
    expect(tracker.pending).toBeUndefined();
    expect(tracker.running).toBe(false);
  });

  it('calls end listeners when a running run ends, not when the process exits', () => {
    const tracker = runningFull();
    let ends = 0;
    tracker.onEnd(() => ends++);
    tracker.apply('ended');
    tracker.apply('sleep-allowed');
    tracker.apply('build-started');
    expect(ends).toBe(1);
    tracker.apply('starting');
    tracker.drop();
    expect(ends).toBe(1);
  });

  it('keeps a full run running after its ended until the late build-started (fact 54)', async () => {
    const tracker = runningFull();
    let ends = 0;
    tracker.onEnd(() => ends++);
    const ended = tracker.ended(60_000);
    tracker.apply('ended');
    tracker.apply('sleep-allowed');
    expect(tracker.running).toBe(true);
    expect(tracker.snapshot()?.state).toBe('running');
    expect(ends).toBe(0);
    tracker.apply('build-started');
    await expect(ended).resolves.toBe(true);
    expect(tracker.snapshot()?.state).toBe('ended');
    expect(ends).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ends the run 10 s after its ended when no build-started comes (spec section 3)', async () => {
    const tracker = runningFull();
    let ends = 0;
    tracker.onEnd(() => ends++);
    const ended = tracker.ended(60_000);
    tracker.apply('ended');
    await vi.advanceTimersByTimeAsync(LATE_START_MS - 1);
    expect(tracker.running).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    await expect(ended).resolves.toBe(true);
    expect(tracker.snapshot()?.state).toBe('ended');
    expect(ends).toBe(1);
    // A late line after that is ignored.
    tracker.apply('build-started');
    expect(ends).toBe(1);
  });

  it('does not end a restarted run with the timer or the late line of the run it replaced (fact 45)', async () => {
    const tracker = runningFull();
    tracker.expect('full');
    for (const event of ['ended', 'sleep-prohibited', 'starting', 'sleep-allowed'] as const)
      tracker.apply(event);
    await vi.advanceTimersByTimeAsync(LATE_START_MS);
    expect(tracker.running).toBe(true);
    tracker.apply('build-started');
    expect(tracker.running).toBe(true);
    tracker.apply('ended');
    tracker.apply('build-started');
    expect(tracker.running).toBe(false);
  });

  it('clears the late-line timer when the process exits or the run is forgotten', () => {
    const dropped = runningFull();
    dropped.apply('ended');
    expect(vi.getTimerCount()).toBe(1);
    dropped.drop();
    expect(vi.getTimerCount()).toBe(0);
    const forgotten = runningFull();
    let ends = 0;
    forgotten.onEnd(() => ends++);
    forgotten.apply('ended');
    forgotten.forget();
    expect(vi.getTimerCount()).toBe(0);
    expect(ends).toBe(1);
    forgotten.apply('build-started');
    expect(ends).toBe(1);
  });

  /** Replays a transcript: the server sends each start, and waits advance the clock. */
  function replay(name: string): { tracker: BuildTracker; running: Record<number, boolean> } {
    const tracker = new BuildTracker();
    const running: Record<number, boolean> = {};
    fixtureLines(`raw/${name}`).forEach((line, index) => {
      if (line === '>>> build start') tracker.expect('full');
      if (line === '>>> build start tiled') tracker.expect('tiled');
      // Spec v2b section 5: the server expects a full run for `group build`.
      if (line.startsWith('>>> group build ')) tracker.expect('full');
      const waited = /^>>> \(waited (\d+) ms\)$/.exec(line)?.[1];
      if (waited !== undefined) vi.advanceTimersByTime(Number(waited));
      const seen = /^>>> \(waited for .*: (?:not )?seen after (\d+) s\)$/.exec(line)?.[1];
      if (seen !== undefined) vi.advanceTimersByTime(Number(seen) * 1_000);
      const event = parseBuildEvent(line);
      if (event === undefined) return;
      tracker.apply(event);
      running[index + 1] = tracker.running;
    });
    return { tracker, running };
  }

  it('replays raw/v2-build-concurrency.txt with no run left running', () => {
    const { tracker, running } = replay('v2-build-concurrency.txt');
    // l.77-81: the second start ends the first build and opens a new run in the same frame (fact 45); the run that
    // ended at l.114 waits for its late line, which the capture never shows, until the tiled start at l.152.
    expect(running).toEqual({
      49: false,
      50: true,
      78: true,
      79: true,
      80: true,
      81: true,
      114: true,
      115: true,
      153: true,
      166: false,
      203: true,
      208: false,
      209: false,
      210: false,
    });
    expect(tracker.running).toBe(false);
  });

  it('replays raw/v2-build-export-timing.txt: each full run ends at its late Build started. (fact 54)', () => {
    const { tracker, running } = replay('v2-build-export-timing.txt');
    expect(running).toEqual({
      23: false,
      24: true,
      29: true,
      30: true,
      38: false,
      51: false,
      52: true,
      53: true,
      54: true,
      60: false,
    });
    expect(tracker.running).toBe(false);
  });

  it.each(['v2-build-export.txt', 'v2-build-isolate.txt', 'v2-build-long.txt'])(
    'replays raw/%s with no run left running',
    (name) => {
      expect(replay(name).tracker.running).toBe(false);
    },
  );

  it('replays raw/v2b-groups.txt: a group build ends at its late line, not at its Ended (spec v2b fact 66)', () => {
    const { tracker, running } = replay('v2b-groups.txt');
    // l.274-283: the frame holds Prohibiting, Starting, and Ended; the trailer and the late line come 3 s later.
    expect(running).toEqual({ 275: false, 276: true, 277: true, 282: true, 283: false });
    expect(tracker.running).toBe(false);
  });

  it('ends a group run 10 s after its ended when its late line does not come (spec v2b section 5)', async () => {
    const tracker = runningFull();
    tracker.apply('ended');
    tracker.apply('sleep-allowed');
    await vi.advanceTimersByTimeAsync(LATE_START_MS - 1);
    expect(tracker.running).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(tracker.running).toBe(false);
    tracker.apply('group-build-started');
    expect(tracker.snapshot()?.state).toBe('ended');
  });

  it('replays raw/v2-build-export.txt: a stopped full build ends at its late line (l.66-80)', () => {
    const { running } = replay('v2-build-export.txt');
    expect(running[69]).toBe(true);
    expect(running[70]).toBe(true);
    expect(running[80]).toBe(false);
  });
});
