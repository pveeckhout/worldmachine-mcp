import { describe, expect, it } from 'vitest';
import { addOutcome } from '../../../../../src/adapter/out/worldmachine/capture/add-reply.js';
import { rawFrame } from '../parsers/fixture.js';

describe('addOutcome (capture-fixtures freshDevice)', () => {
  it('reads an Added line as added (wm-4070/raw/build-not-built-timing.txt l.8-9)', () => {
    const reply = rawFrame('build-not-built-timing.txt', 'device add Gradient', 0, '4070');
    expect(addOutcome('Gradient', reply)).toEqual({ kind: 'added' });
  });

  it('reads File Output as added on build 4067, which gave a Height Output (wm-4067/raw/v3-rename-types.txt l.204-205)', () => {
    const reply = rawFrame('v3-rename-types.txt', 'device add File Output', 0, '4067');
    expect(addOutcome('File Output', reply)).toEqual({ kind: 'added' });
  });

  it('retries an ambiguous File Output as Height Output (wm-4070/raw/build-not-built-timing.txt l.23-24)', () => {
    const reply = rawFrame('build-not-built-timing.txt', 'device add File Output', 0, '4070');
    expect(addOutcome('File Output', reply)).toEqual({ kind: 'retry', word: 'Height Output' });
  });

  it('refuses an ambiguous word without a fallback (wm-4069/raw/enum-options.txt l.966)', () => {
    const reply = rawFrame('enum-options.txt', 'device add Brightness', 0, '4069');
    expect(addOutcome('Brightness', reply)).toEqual({ kind: 'refused' });
  });

  it('refuses an ambiguous File Output whose matches leave out Height Output', () => {
    const reply = ["Error: Error: Tag 'File Output' matches multiple devices: VDM Output, Splat Output"];
    expect(addOutcome('File Output', reply)).toEqual({ kind: 'refused' });
  });

  it('refuses any other answer, and reads no fallback from Object.prototype', () => {
    expect(addOutcome('Gradient', ['Error: Error: Unknown device type'])).toEqual({ kind: 'refused' });
    expect(
      addOutcome('constructor', ["Error: Error: Tag 'constructor' matches multiple devices: A, B"]),
    ).toEqual({
      kind: 'refused',
    });
    expect(addOutcome('Gradient', [])).toEqual({ kind: 'refused' });
  });
});
