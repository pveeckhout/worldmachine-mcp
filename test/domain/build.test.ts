import { describe, expect, it } from 'vitest';
import {
  type BuildEvent,
  type BuildState,
  isRunning,
  lateStartMissed,
  NO_BUILD,
  nextBuildState,
  stopRequested,
} from '../../src/domain/build.js';

/** Applies events in order; the n-th event of one call arrives at time 1000 + n. */
const apply = (state: BuildState, ...events: BuildEvent[]): BuildState =>
  events.reduce((current, event, index) => nextBuildState(current, event, 1_000 + index), state);

describe('nextBuildState (spec v2a section 3)', () => {
  it('opens a server full run on starting and closes it on the late build-started after ended (facts 43, 54)', () => {
    const started = apply({ ...NO_BUILD, pending: 'full' }, 'sleep-prohibited', 'starting');
    expect(started).toEqual({
      run: { mode: 'full', startedAt: 1_001, startedBy: 'server', state: 'running' },
      pending: undefined,
      trailerOwed: false,
      lateStartsOwed: 0,
      ending: false,
    });
    // Fact 54 (raw/v2-build-export-timing.txt l.29-41): outputs are not exportable until the late line.
    const afterEnded = apply(started, 'ended', 'sleep-allowed');
    expect(afterEnded).toEqual({ ...started, lateStartsOwed: 1, ending: true });
    expect(isRunning(afterEnded)).toBe(true);
    const ended = apply(afterEnded, 'build-started');
    expect(ended).toEqual({
      run: { mode: 'full', startedAt: 1_001, startedBy: 'server', state: 'ended' },
      pending: undefined,
      trailerOwed: false,
      lateStartsOwed: 0,
      ending: false,
    });
    expect(isRunning(ended)).toBe(false);
  });

  it('changes no run on an other event, such as an automatic export (spec v2b fact 71)', () => {
    const running = apply({ ...NO_BUILD, pending: 'full' }, 'starting');
    expect(apply(running, 'other')).toEqual(running);
    const ending = apply(running, 'ended');
    expect(apply(ending, 'other')).toEqual(ending);
    expect(apply(NO_BUILD, 'other')).toEqual(NO_BUILD);
  });

  it('ignores a build-started that no ended owes', () => {
    const running = apply({ ...NO_BUILD, pending: 'full' }, 'starting');
    expect(apply(running, 'build-started')).toEqual(running);
    expect(apply(NO_BUILD, 'build-started')).toEqual(NO_BUILD);
  });

  it('ends an ending full run when its late build-started does not come (lateStartMissed, spec section 3)', () => {
    const ending = apply({ ...NO_BUILD, pending: 'full' }, 'starting', 'ended');
    const missed = lateStartMissed(ending);
    expect(missed).toEqual({
      run: { mode: 'full', startedAt: 1_000, startedBy: 'server', state: 'ended' },
      pending: undefined,
      trailerOwed: true,
      lateStartsOwed: 0,
      ending: false,
    });
    const running = apply({ ...NO_BUILD, pending: 'full' }, 'starting');
    expect(lateStartMissed(running)).toBe(running);
    expect(lateStartMissed(NO_BUILD)).toBe(NO_BUILD);
  });

  it("owes one build-started per ended across a restart, so the old run's late line does not end the new run (fact 45)", () => {
    const first = apply({ ...NO_BUILD, pending: 'full' }, 'starting');
    const restarted = apply(
      { ...first, pending: 'full' },
      'ended',
      'sleep-prohibited',
      'starting',
      'sleep-allowed',
    );
    expect(restarted.lateStartsOwed).toBe(1);
    expect(restarted.ending).toBe(false);
    const oldLine = apply(restarted, 'build-started');
    expect(isRunning(oldLine)).toBe(true);
    expect(oldLine.lateStartsOwed).toBe(0);
    const ended = apply(oldLine, 'ended', 'sleep-allowed', 'build-started');
    expect(isRunning(ended)).toBe(false);
    // Without the old run's line, the new run's own line leaves one owed and the run running.
    const stillOwed = apply(restarted, 'ended', 'sleep-allowed', 'build-started');
    expect(isRunning(stillOwed)).toBe(true);
    expect(stillOwed).toMatchObject({ lateStartsOwed: 1, ending: true });
    expect(isRunning(apply(stillOwed, 'build-started'))).toBe(false);
  });

  it("ends a full run on a group build's late line, as on Build started. (spec v2b fact 66)", () => {
    const ending = apply(
      { ...NO_BUILD, pending: 'full' },
      'sleep-prohibited',
      'starting',
      'ended',
      'sleep-allowed',
    );
    expect(isRunning(ending)).toBe(true);
    expect(apply(ending, 'group-build-started')).toEqual({
      run: { mode: 'full', startedAt: 1_001, startedBy: 'server', state: 'ended' },
      pending: undefined,
      trailerOwed: false,
      lateStartsOwed: 0,
      ending: false,
    });
  });

  it('opens a full run on starting after a group start, and still ends it on its late line (spec v2b fact 66)', () => {
    const running = apply({ ...NO_BUILD, pending: 'group' }, 'sleep-prohibited', 'starting');
    expect(running.run).toEqual({ mode: 'full', startedAt: 1_001, startedBy: 'server', state: 'running' });
    expect(running.pending).toBeUndefined();
    const ending = apply(running, 'ended', 'sleep-allowed');
    expect(isRunning(ending)).toBe(true);
    const ended = apply(ending, 'group-build-started');
    expect(isRunning(ended)).toBe(false);
    expect(ended.groupRun).toBeUndefined();
  });

  it('ends a stopped group run that replaced a full run only on the late line still owed (facts 45, 72)', () => {
    const first = apply({ ...NO_BUILD, pending: 'full' }, 'starting');
    const replaced = apply({ ...first, pending: 'group' }, 'ended', 'starting', 'sleep-allowed');
    expect(replaced).toMatchObject({ lateStartsOwed: 1, groupRun: 'started' });
    const stopped = apply(stopRequested(replaced), 'ended', 'sleep-allowed');
    expect(isRunning(stopped)).toBe(true);
    expect(stopped).toMatchObject({ lateStartsOwed: 1, ending: true });
    const ended = apply(stopped, 'build-started');
    expect(isRunning(ended)).toBe(false);
    expect(ended).toMatchObject({ lateStartsOwed: 0, ending: false, groupRun: undefined });
  });

  it('ends a stopped server group run on its trailer, owing no late line (spec v2b fact 72)', () => {
    const running = apply({ ...NO_BUILD, pending: 'group' }, 'sleep-prohibited', 'starting');
    // raw/v2b-assumptions.txt l.223-226: Stop requested., Ended, and the trailer, then no late line.
    const stopping = apply(stopRequested(running), 'ended');
    expect(isRunning(stopping)).toBe(true);
    expect(stopping).toMatchObject({ lateStartsOwed: 0, trailerOwed: true });
    expect(apply(stopping, 'sleep-allowed')).toEqual({
      run: { mode: 'full', startedAt: 1_001, startedBy: 'server', state: 'ended' },
      pending: undefined,
      trailerOwed: false,
      lateStartsOwed: 0,
      ending: false,
    });
  });

  it('ends a stopped full build on its late line, as before (spec v2a fact 54, raw/v2-build-export.txt l.66-80)', () => {
    const running = apply({ ...NO_BUILD, pending: 'full' }, 'sleep-prohibited', 'starting');
    const stopped = apply(stopRequested(running), 'ended', 'sleep-allowed');
    expect(isRunning(stopped)).toBe(true);
    expect(stopped).toMatchObject({ lateStartsOwed: 1, ending: true });
    expect(isRunning(apply(stopped, 'build-started'))).toBe(false);
  });

  it('ends a stopped build from the window on its trailer, owing no late line (A1, raw/v2a-a1-window-builds.txt)', () => {
    const running = apply(NO_BUILD, 'sleep-prohibited', 'starting');
    const stopped = apply(stopRequested(running), 'ended', 'sleep-allowed');
    expect(isRunning(stopped)).toBe(false);
    expect(stopped).toMatchObject({ lateStartsOwed: 0, ending: false });
  });

  it('changes nothing on a stop request without a running server group run', () => {
    expect(stopRequested(NO_BUILD)).toEqual(NO_BUILD);
    const tiled = apply({ ...NO_BUILD, pending: 'tiled' }, 'sleep-prohibited');
    expect(stopRequested(tiled)).toEqual(tiled);
    const ending = apply({ ...NO_BUILD, pending: 'group' }, 'starting', 'ended');
    expect(apply(stopRequested(ending), 'sleep-allowed')).toMatchObject({ lateStartsOwed: 1, ending: true });
  });

  it('ignores a group late line that no ended owes', () => {
    const running = apply({ ...NO_BUILD, pending: 'full' }, 'starting');
    expect(apply(running, 'group-build-started')).toEqual(running);
    expect(apply(NO_BUILD, 'group-build-started')).toEqual(NO_BUILD);
  });

  it('ends a group build started in the World Machine window on its late line (spec v2b section 5)', () => {
    const ended = apply(
      NO_BUILD,
      'sleep-prohibited',
      'starting',
      'ended',
      'sleep-allowed',
      'group-build-started',
    );
    expect(isRunning(ended)).toBe(false);
    expect(ended.run).toEqual({ mode: 'full', startedAt: 1_000, startedBy: 'world-machine', state: 'ended' });
  });

  it('owes one late line per ended when a group build replaces a full run, whichever line pays (fact 45)', () => {
    const first = apply({ ...NO_BUILD, pending: 'full' }, 'starting');
    const replaced = apply(
      { ...first, pending: 'full' },
      'ended',
      'sleep-prohibited',
      'starting',
      'sleep-allowed',
    );
    expect(replaced.lateStartsOwed).toBe(1);
    const oldLine = apply(replaced, 'build-started');
    expect(isRunning(oldLine)).toBe(true);
    expect(apply(oldLine, 'ended', 'sleep-allowed', 'group-build-started')).toMatchObject({
      run: { mode: 'full', startedBy: 'server', state: 'ended' },
      lateStartsOwed: 0,
      ending: false,
    });
  });

  it('replaces a running full run when a new one starts (fact 45, raw/v2-build-long.txt l.57-60)', () => {
    const first = apply({ ...NO_BUILD, pending: 'full' }, 'starting');
    const second = apply(
      { ...first, pending: 'full' },
      'ended',
      'sleep-prohibited',
      'starting',
      'sleep-allowed',
    );
    expect(second).toEqual({
      run: { mode: 'full', startedAt: 1_002, startedBy: 'server', state: 'running' },
      pending: undefined,
      trailerOwed: false,
      lateStartsOwed: 1,
      ending: false,
    });
  });

  it('opens a full run on a starting without a pending server start as started in World Machine (assumption A1)', () => {
    expect(apply(NO_BUILD, 'starting').run).toEqual({
      mode: 'full',
      startedAt: 1_000,
      startedBy: 'world-machine',
      state: 'running',
    });
  });

  it('opens a provisional World Machine run on an unowned sleep-prohibited and ends it on sleep-allowed (a tiled build from the window, A1)', () => {
    const started = apply(NO_BUILD, 'sleep-prohibited');
    expect(started).toEqual({
      run: { mode: 'unknown', startedAt: 1_000, startedBy: 'world-machine', state: 'running' },
      pending: undefined,
      trailerOwed: false,
      lateStartsOwed: 0,
      ending: false,
    });
    expect(isRunning(started)).toBe(true);
    const ended = apply(started, 'sleep-allowed', 'tiled-started');
    expect(ended.run).toEqual({
      mode: 'unknown',
      startedAt: 1_000,
      startedBy: 'world-machine',
      state: 'ended',
    });
    expect(isRunning(ended)).toBe(false);
  });

  it('ends a window-started full run on its trailer, owing no late line (A1, raw/v2a-a1-window-builds.txt)', () => {
    // The capture: Prohibiting, Starting, Ended, Allowed, and no `Build started.`, which answers a console start.
    const ended = apply(NO_BUILD, 'sleep-prohibited', 'starting', 'ended', 'sleep-allowed');
    expect(ended).toEqual({
      run: { mode: 'full', startedAt: 1_000, startedBy: 'world-machine', state: 'ended' },
      pending: undefined,
      trailerOwed: false,
      lateStartsOwed: 0,
      ending: false,
      groupRun: undefined,
    });
  });

  it('ends a server full build started after a window build on its own late line (A1)', () => {
    const window = apply(NO_BUILD, 'sleep-prohibited', 'starting', 'ended', 'sleep-allowed');
    const server = apply(
      { ...window, pending: 'full' },
      'sleep-prohibited',
      'starting',
      'ended',
      'sleep-allowed',
    );
    expect(server).toMatchObject({ lateStartsOwed: 1, ending: true });
    expect(isRunning(apply(server, 'build-started'))).toBe(false);
  });

  it('promotes a provisional run to full on starting (a full build from the window, A1)', () => {
    const started = apply(NO_BUILD, 'sleep-prohibited', 'starting');
    expect(started.run).toEqual({
      mode: 'full',
      startedAt: 1_000,
      startedBy: 'world-machine',
      state: 'running',
    });
    const ended = apply(started, 'ended', 'sleep-allowed', 'build-started');
    expect(ended).toEqual({
      run: { mode: 'full', startedAt: 1_000, startedBy: 'world-machine', state: 'ended' },
      pending: undefined,
      trailerOwed: false,
      lateStartsOwed: 0,
      ending: false,
    });
  });

  it('keeps a window restart running across the old trailer and ends it on the trailer of its stop (raw/v2-build-long.txt l.56-68, A1)', () => {
    const first = apply(NO_BUILD, 'sleep-prohibited', 'starting');
    // l.57-60: Ended, Prohibiting, Starting, then the first run's trailer, all in one frame.
    const restarted = apply(first, 'ended', 'sleep-prohibited', 'starting', 'sleep-allowed');
    expect(restarted).toEqual({
      run: { mode: 'full', startedAt: 1_001, startedBy: 'world-machine', state: 'running' },
      pending: undefined,
      trailerOwed: false,
      lateStartsOwed: 0,
      ending: false,
    });
    // l.62-67: Ended in the stop frame, the trailer in the next one. A window-started run owes no late line, so the
    // trailer ends it.
    const stopped = apply(restarted, 'ended');
    expect(isRunning(stopped)).toBe(true);
    expect(stopped).toMatchObject({ trailerOwed: true, lateStartsOwed: 0, ending: true });
    expect(isRunning(apply(stopped, 'sleep-allowed'))).toBe(false);
  });

  it('keeps a running run on a sleep-prohibited that no start explains', () => {
    const running = apply({ ...NO_BUILD, pending: 'full' }, 'starting');
    expect(apply(running, 'sleep-prohibited')).toEqual(running);
  });

  it('opens a tiled run on sleep-prohibited after a tiled start and closes it on sleep-allowed (fact 48)', () => {
    const started = apply({ ...NO_BUILD, pending: 'tiled' }, 'sleep-prohibited');
    expect(started).toEqual({
      run: { mode: 'tiled', startedAt: 1_000, startedBy: 'server', state: 'running' },
      pending: undefined,
      trailerOwed: false,
      lateStartsOwed: 0,
      ending: false,
    });
    const ended = apply(started, 'sleep-allowed', 'tiled-started', 'tiled-started');
    expect(ended.run?.state).toBe('ended');
  });

  it('ignores sleep-prohibited while a server full start is pending (fact 43)', () => {
    expect(apply({ ...NO_BUILD, pending: 'full' }, 'sleep-prohibited')).toEqual({
      ...NO_BUILD,
      pending: 'full',
    });
  });

  it('closes a run only with the end event of its own mode', () => {
    expect(isRunning(apply({ ...NO_BUILD, pending: 'tiled' }, 'sleep-prohibited', 'ended'))).toBe(true);
    expect(isRunning(apply({ ...NO_BUILD, pending: 'full' }, 'starting', 'sleep-allowed'))).toBe(true);
  });

  it('keeps a pending tiled start across a stale sleep-allowed of an earlier run', () => {
    expect(apply({ ...NO_BUILD, pending: 'tiled' }, 'sleep-allowed', 'build-started')).toEqual({
      ...NO_BUILD,
      pending: 'tiled',
    });
  });

  it('keeps a tiled run open across the late trailer of the full run before it (raw/v2-build-long.txt l.57-67)', () => {
    const ended = apply({ ...NO_BUILD, pending: 'full' }, 'starting', 'ended');
    expect(ended.trailerOwed).toBe(true);
    const tiled = apply({ ...ended, pending: 'tiled' }, 'sleep-prohibited', 'sleep-allowed');
    expect(tiled).toEqual({
      run: { mode: 'tiled', startedAt: 1_000, startedBy: 'server', state: 'running' },
      pending: undefined,
      trailerOwed: false,
      lateStartsOwed: 1,
      ending: false,
    });
    expect(apply(tiled, 'sleep-allowed').run?.state).toBe('ended');
  });
});
