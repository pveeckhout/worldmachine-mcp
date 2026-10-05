import { describe, expect, it } from 'vitest';
import { WorldMachineError } from '../../src/domain/errors.js';

describe('WorldMachineError', () => {
  it('carries code, message, and the optional World Machine text', () => {
    const error = new WorldMachineError('WM_COMMAND_FAILED', 'rejected', "Error: Unknown command: 'x'");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('WorldMachineError');
    expect(error.code).toBe('WM_COMMAND_FAILED');
    expect(error.message).toBe('rejected');
    expect(error.worldMachineMessage).toBe("Error: Unknown command: 'x'");
  });

  it('leaves worldMachineMessage undefined when not given', () => {
    expect(new WorldMachineError('TIMEOUT', 'late').worldMachineMessage).toBeUndefined();
  });
});

describe('SHUTTING_DOWN', () => {
  it('is a valid error code', () => {
    expect(new WorldMachineError('SHUTTING_DOWN', 'stopping').code).toBe('SHUTTING_DOWN');
  });
});
