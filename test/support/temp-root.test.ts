import { tmpdir } from 'node:os';
import { basename, dirname } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('per-run temporary root (test/support/temp-root.ts)', () => {
  it('points tmpdir() into the run folder that the global setup removes afterwards', () => {
    expect(basename(tmpdir())).toMatch(/^worldmachine-mcp-tests-/);
    expect(dirname(tmpdir())).not.toBe(tmpdir());
  });
});
