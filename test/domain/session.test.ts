import { describe, expect, it } from 'vitest';
import { summarize } from '../../src/domain/session.js';

describe('summarize', () => {
  it('reports only the state for notRunning and starting', () => {
    expect(summarize({ kind: 'notRunning' })).toEqual({ state: 'notRunning' });
    expect(summarize({ kind: 'starting' })).toEqual({ state: 'starting' });
  });

  it('reports binding and dirty flag when ready', () => {
    expect(summarize({ kind: 'ready', binding: { kind: 'opened', path: '/p/a.tmd' }, dirty: true })).toEqual({
      state: 'ready',
      binding: { kind: 'opened', path: '/p/a.tmd' },
      dirty: true,
    });
  });

  it('reports the reason when unhealthy', () => {
    expect(summarize({ kind: 'unhealthy', reason: 'timeout' })).toEqual({
      state: 'unhealthy',
      reason: 'timeout',
    });
  });
});
