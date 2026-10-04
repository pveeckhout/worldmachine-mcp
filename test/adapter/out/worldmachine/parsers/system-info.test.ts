import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSystemInfo } from '../../../../../src/adapter/out/worldmachine/parsers/system-info.js';
import type { WorldMachineError } from '../../../../../src/domain/errors.js';

const fixture = readFileSync(new URL('../../../../fixtures/wm-4067/system-info.txt', import.meta.url), 'utf8')
  .split('\n')
  .filter((line) => line !== '');

describe('parseSystemInfo', () => {
  it('reads build, build name, and architecture', () => {
    expect(parseSystemInfo(fixture)).toEqual({
      build: 4067,
      buildName: 'Dragontail Peak',
      arch: 'x64-AVX2 (256-bit)',
    });
  });

  it('fails with UNEXPECTED_OUTPUT and a snippet when the version line is missing', () => {
    try {
      parseSystemInfo(['World Machine System Info:', '  Arch:     x64']);
      expect.unreachable();
    } catch (error) {
      expect((error as WorldMachineError).code).toBe('UNEXPECTED_OUTPUT');
      expect((error as WorldMachineError).worldMachineMessage).toContain('World Machine System Info:');
    }
  });

  it('fails with UNEXPECTED_OUTPUT and a snippet when the arch line is missing', () => {
    try {
      parseSystemInfo(['World Machine System Info:', "  Version:  Build 4067 'Dragontail Peak'"]);
      expect.unreachable();
    } catch (error) {
      expect((error as WorldMachineError).code).toBe('UNEXPECTED_OUTPUT');
      expect((error as WorldMachineError).worldMachineMessage).toContain('World Machine System Info:');
    }
  });
});
