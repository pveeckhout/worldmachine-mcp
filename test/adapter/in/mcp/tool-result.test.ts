import { describe, expect, it } from 'vitest';
import { failure } from '../../../../src/adapter/in/mcp/tool-result.js';
import { WorldMachineError } from '../../../../src/domain/errors.js';
import type { SessionSummary } from '../../../../src/domain/session.js';

const session = { state: 'ready', dirty: false } as unknown as SessionSummary;

describe('failure', () => {
  it('keeps the error code and message when details carry keys of the same names', () => {
    const error = new WorldMachineError('APPLY_FAILED', 'Step 3 failed', undefined, {
      code: 'OTHER',
      message: 'overwritten',
      failedStep: 3,
    });
    const first = failure(error, session).content[0];
    expect(first && JSON.parse(first.text)).toMatchObject({
      code: 'APPLY_FAILED',
      message: 'Step 3 failed',
      failedStep: 3,
    });
  });
});
