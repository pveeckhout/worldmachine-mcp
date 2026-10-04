import { accessSync, constants, statSync } from 'node:fs';
import path from 'node:path';

/** v1 has no default discovery: the configured path must be an executable file. */
export function resolveExecutable(value: string | null): string | null {
  if (value === null) return null;
  const resolved = path.resolve(value);
  try {
    if (!statSync(resolved).isFile()) return null;
    accessSync(resolved, constants.X_OK);
    return resolved;
  } catch {
    return null;
  }
}
