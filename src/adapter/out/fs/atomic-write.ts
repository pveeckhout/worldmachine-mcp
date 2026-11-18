import { closeSync, fsyncSync, openSync, renameSync, rmSync, writeSync } from 'node:fs';

/** Whole-file write: `<path>.<pid>.tmp` in the same folder, synced, then renamed over the target. */
export function writeFileAtomic(path: string, text: string): void {
  const temp = `${path}.${process.pid}.tmp`;
  try {
    const fd = openSync(temp, 'w');
    try {
      writeSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
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
