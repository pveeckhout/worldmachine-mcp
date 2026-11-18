import { describe, expect, it } from 'vitest';
import { WireVerdicts } from '../../../src/application/service/wire-verdicts.js';
import type { WireTyping } from '../../../src/domain/catalog.js';
import { WorldMachineError } from '../../../src/domain/errors.js';
import { sampleDerivedPortTypes, syntheticPortTypes } from '../../support/port-types.js';
import { memoryRecorder } from '../../support/wire-verdicts.js';

const water = { type: 'Create Water', port: 'Water System' };
const output = { type: 'Height Output', port: 'Primary Input' };
const typed = (predicted: WireTyping['predicted']): WireTyping => ({
  output: water,
  input: output,
  predicted,
});
const now = () => new Date('2026-11-17T00:00:00.000Z');

describe('WireVerdicts', () => {
  it('records a contradicting verdict with build, pair, source, and time', () => {
    const store = memoryRecorder();
    const report = new WireVerdicts(sampleDerivedPortTypes, store, now).observe(
      typed('compatible'),
      'refused',
      'connect_devices',
    );
    expect(report).toMatchObject({ outcome: 'recorded', verdict: 'refused', predicted: 'compatible' });
    expect(store.recorded).toEqual([
      {
        build: 4067,
        output: water,
        input: output,
        verdict: 'refused',
        source: 'connect_devices',
        at: '2026-11-17T00:00:00.000Z',
      },
    ]);
  });

  it('records nothing when the verdict agrees with the prediction', () => {
    const store = memoryRecorder();
    const verdicts = new WireVerdicts(sampleDerivedPortTypes, store, now);
    expect(verdicts.observe(typed('compatible'), 'accepted', 'apply_graph')).toBeUndefined();
    expect(store.recorded).toEqual([]);
  });

  it('reports without recording on a strict catalog', () => {
    const store = memoryRecorder();
    const report = new WireVerdicts(syntheticPortTypes, store, now).observe(
      typed('compatible'),
      'refused',
      'apply_graph',
    );
    expect(report).toMatchObject({ outcome: 'reported', reason: 'strict catalog' });
    expect(store.recorded).toEqual([]);
  });

  it('answers undefined without typing', () => {
    const store = memoryRecorder();
    expect(
      new WireVerdicts(sampleDerivedPortTypes, store, now).observe(undefined, 'refused', 'apply_graph'),
    ).toBeUndefined();
  });

  it('reports instead of recording when the store refuses', () => {
    const throwingStore = {
      record: () => {
        throw new Error('corrections for build 4067 were not loaded');
      },
    };
    const report = new WireVerdicts(sampleDerivedPortTypes, throwingStore, now).observe(
      typed('compatible'),
      'refused',
      'apply_graph',
    );
    expect(report).toMatchObject({ outcome: 'reported', reason: expect.stringContaining('were not loaded') });
  });

  it('observes a refusal that carries typing, and ignores any other error', () => {
    const store = memoryRecorder();
    const verdicts = new WireVerdicts(sampleDerivedPortTypes, store, now);
    const refusal = new WorldMachineError('WM_COMMAND_FAILED', 'incompatible types?', undefined, {
      typing: typed('compatible'),
    });
    expect(verdicts.observeRefusal(refusal, 'connect_devices')).toMatchObject({ verdict: 'refused' });
    expect(store.recorded).toHaveLength(1);
    expect(
      verdicts.observeRefusal(new WorldMachineError('REFUSED', 'no'), 'connect_devices'),
    ).toBeUndefined();
    expect(verdicts.observeRefusal(new Error('boom'), 'connect_devices')).toBeUndefined();
  });
});
