import { renameSync, rmSync, writeFileSync } from 'node:fs';

/** Whole-file write: `<path>.<pid>.tmp` in the same folder, then rename over the target. */
export function writeFileAtomic(path: string, text: string): void {
  const temp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, text);
    renameSync(temp, path);
  } catch (error) {
    try {
      rmSync(temp, { force: true });
    } catch {
      // The original error is the one worth reporting.
    }
    throw error;
  }
}
