import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseBuildEvent } from '../../../../src/adapter/out/worldmachine/build-events.js';
import { BuildTracker } from '../../../../src/adapter/out/worldmachine/build-tracker.js';
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

  it('keeps a window restart running across the owed trailer of the run it replaced (raw/v2-build-long.txt l.56-68)', () => {
    const tracker = new BuildTracker();
    tracker.apply('sleep-prohibited');
    tracker.apply('starting');
    for (const event of ['ended', 'sleep-prohibited', 'starting', 'sleep-allowed'] as const) {
      tracker.apply(event);
    }
    expect(tracker.snapshot()).toMatchObject({ mode: 'full', startedBy: 'world-machine', state: 'running' });
    tracker.apply('ended');
    tracker.apply('sleep-allowed');
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
    tracker.drop();
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
    expect(ends).toBe(1);
    tracker.apply('starting');
    tracker.drop();
    expect(ends).toBe(1);
  });

  it('replays raw/v2-build-concurrency.txt with the server sending each start', () => {
    const tracker = new BuildTracker();
    const running: Record<number, boolean> = {};
    fixtureLines('raw/v2-build-concurrency.txt').forEach((line, index) => {
      if (line === '>>> build start') tracker.expect('full');
      if (line === '>>> build start tiled') tracker.expect('tiled');
      const event = parseBuildEvent(line);
      if (event === undefined) return;
      tracker.apply(event);
      running[index + 1] = tracker.running;
    });
    // l.77-81: the second start ends the first build and opens a new run in the same frame (fact 45).
    expect(running).toEqual({
      49: false,
      50: true,
      78: false,
      79: false,
      80: true,
      81: true,
      114: false,
      115: false,
      153: true,
      166: false,
      203: true,
      208: false,
      209: false,
      210: false,
    });
  });
});
