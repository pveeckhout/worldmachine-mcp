// Vitest global setup: builds `dist` once per run. The smoke tests and the script wrappers in scripts/ import or run
// the built package, so a run on a clean tree, or with a stale dist, must not depend on an earlier `npm run build`.
import { spawnSync } from 'node:child_process';

export default function setup(): void {
  const result = spawnSync('npm', ['run', 'build'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) throw new Error('npm run build failed');
}
