// Vitest global setup: every test run gets one temporary root, removed when the run ends. Tests create their folders
// with `mkdtempSync(join(tmpdir(), …))`, and `tmpdir()` reads TMPDIR, which the workers and the processes they spawn
// inherit, so nothing a run creates is left under the system temporary folder.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default function setup(): () => void {
  const previous = process.env.TMPDIR;
  const root = mkdtempSync(join(tmpdir(), 'worldmachine-mcp-tests-'));
  process.env.TMPDIR = root;
  return () => {
    if (previous === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previous;
    rmSync(root, { recursive: true, force: true });
  };
}
