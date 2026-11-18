import { describe, expect, it } from 'vitest';
import { PHASE_MINUTES } from '../../src/adapter/out/worldmachine/capture/durations.js';
import { busyMessage, CatalogCapture, captureRefusal } from '../../src/domain/catalog-capture.js';

const t = (ms: number): Date => new Date(ms);

describe('captureRefusal', () => {
  it('refuses any capture when the build has a strict catalog', () => {
    expect(captureRefusal('full', [{ build: 4067, kind: 'strict', origin: 'shipped' }], 4067)).toMatch(
      /build 4067 already has a strict catalog/,
    );
  });
  it('refuses a short capture when the build has any port-type catalog', () => {
    expect(
      captureRefusal('short', [{ build: 4069, kind: 'sample-derived', origin: 'shipped' }], 4069),
    ).toMatch(/full/);
  });
  it('allows a full capture over a sample-derived catalog', () => {
    expect(
      captureRefusal('full', [{ build: 4069, kind: 'sample-derived', origin: 'shipped' }], 4069),
    ).toBeUndefined();
  });
  it('allows a capture when other builds have catalogs', () => {
    expect(
      captureRefusal('short', [{ build: 4067, kind: 'strict', origin: 'shipped' }], 4071),
    ).toBeUndefined();
  });
});

describe('CatalogCapture', () => {
  it('estimates the time left from progress', () => {
    const c = new CatalogCapture(4071, 'short', t(0), PHASE_MINUTES);
    c.progress({ phase: 'sample', done: 50, total: 100 }, t(60_000));
    expect(c.view(t(60_000)).percent).toBeGreaterThan(0);
    expect(c.minutesLeft(t(60_000))).toBeGreaterThan(0);
  });
  it('has no estimate before any unit is done', () => {
    const c = new CatalogCapture(4071, 'short', t(0), PHASE_MINUTES);
    expect(c.minutesLeft(t(1000))).toBeUndefined();
    c.progress({ phase: 'enum', done: 0, total: 10 }, t(1000));
    expect(c.minutesLeft(t(1000))).toBeUndefined();
    expect(c.view(t(1000)).percent).toBe(PHASE_MINUTES.discover === 0 ? 0 : Math.round((1 / 11) * 100));
  });
  it('adds the fixed estimates of the phases still to come', () => {
    const c = new CatalogCapture(4071, 'full', t(0), PHASE_MINUTES);
    c.progress({ phase: 'enum', done: 5, total: 10 }, t(60_000));
    // 1 min for the other half of enum, plus the probe phase
    expect(c.minutesLeft(t(60_000))).toBe(1 + PHASE_MINUTES.probe);
  });
  it('keeps percent an integer within 0 and 100', () => {
    const c = new CatalogCapture(4071, 'short', t(0), PHASE_MINUTES);
    c.progress({ phase: 'sample', done: 100, total: 100 }, t(1000));
    const { percent } = c.view(t(1000));
    expect(Number.isInteger(percent)).toBe(true);
    expect(percent).toBeLessThanOrEqual(100);
  });
  it('reports the outcome once finished', () => {
    const c = new CatalogCapture(4071, 'short', t(0), PHASE_MINUTES);
    c.finish({ kind: 'cancelled' });
    const view = c.view(t(10));
    expect(view.outcome).toEqual({ kind: 'cancelled' });
    expect(view.minutesLeft).toBeUndefined();
  });
});

describe('busyMessage', () => {
  it('names the build, mode, phase, percent, and time left', () => {
    expect(busyMessage({ build: 4071, mode: 'short', phase: 'sample', percent: 40, minutesLeft: 4 })).toBe(
      'World Machine is capturing the catalog of build 4071 (short, sample, 40%, about 4 min left); try again later or cancel_catalog_capture',
    );
  });
  it('leaves the estimate out when there is none', () => {
    expect(
      busyMessage({ build: 4071, mode: 'full', phase: 'enum', percent: 0, minutesLeft: undefined }),
    ).toBe(
      'World Machine is capturing the catalog of build 4071 (full, enum, 0%); try again later or cancel_catalog_capture',
    );
  });
});
