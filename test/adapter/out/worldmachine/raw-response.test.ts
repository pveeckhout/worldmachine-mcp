import { describe, expect, it } from 'vitest';
import { requireFrame, throwIfFailed } from '../../../../src/adapter/out/worldmachine/raw-response.js';
import { WorldMachineError } from '../../../../src/domain/errors.js';

describe('throwIfFailed', () => {
  it('passes a response without errors', () => {
    expect(() => throwIfFailed({ command: 'device list', output: [], errors: [] })).not.toThrow();
  });

  it('throws WM_COMMAND_FAILED with the exact World Machine text', () => {
    try {
      throwIfFailed({
        command: 'device delete X',
        output: [],
        errors: ['Error: no such device', 'Error: second'],
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(WorldMachineError);
      const e = error as WorldMachineError;
      expect(e.code).toBe('WM_COMMAND_FAILED');
      expect(e.message).toContain('device delete X');
      expect(e.worldMachineMessage).toBe('Error: no such device\nError: second');
    }
  });
});

describe('requireFrame', () => {
  it('throws UNEXPECTED_OUTPUT for a missing frame', () => {
    expect(() => requireFrame(undefined)).toThrow(WorldMachineError);
  });
});
