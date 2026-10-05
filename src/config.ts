import path from 'node:path';
import { isLogLevel, type LogLevel } from './logger.js';

export type Config = {
  readonly bin: string | null;
  readonly allowedRoots: readonly string[] | null;
  readonly defaultProject: string | undefined;
  readonly logLevel: LogLevel;
  readonly commandTimeoutMs: number;
  readonly idleTimeoutMs: number;
};

export function loadConfig(
  env: Readonly<Record<string, string | undefined>>,
  cwd: string,
  home: string,
): Config {
  return {
    bin: nonBlank(env.WORLD_MACHINE_BIN) ?? null,
    allowedRoots: allowedRoots(env.WORLD_MACHINE_ALLOWED_ROOTS, cwd, home),
    defaultProject: nonBlank(env.WORLD_MACHINE_DEFAULT_PROJECT),
    logLevel: logLevel(env.WORLD_MACHINE_LOG_LEVEL),
    commandTimeoutMs: integer(
      'WORLD_MACHINE_COMMAND_TIMEOUT_MS',
      env.WORLD_MACHINE_COMMAND_TIMEOUT_MS,
      15_000,
      1,
    ),
    idleTimeoutMs: integer('WORLD_MACHINE_IDLE_TIMEOUT_MS', env.WORLD_MACHINE_IDLE_TIMEOUT_MS, 900_000, 0),
  };
}

function nonBlank(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function allowedRoots(value: string | undefined, cwd: string, home: string): readonly string[] | null {
  const configured = (value ?? '')
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .map((entry) => path.resolve(cwd, entry));
  if (configured.length > 0) return configured;
  const resolved = path.resolve(cwd);
  if (resolved === path.parse(resolved).root || resolved === path.resolve(home)) return null;
  return [resolved];
}

function logLevel(value: string | undefined): LogLevel {
  const normalized = nonBlank(value)?.toLowerCase();
  if (normalized === undefined) return 'info';
  if (!isLogLevel(normalized)) {
    throw new Error(`WORLD_MACHINE_LOG_LEVEL must be one of error, warn, info, debug; got "${value}"`);
  }
  return normalized;
}

// Node clamps timers above this to 1 ms.
const MAX_TIMER_MS = 2_147_483_647;

function integer(name: string, value: string | undefined, fallback: number, minimum: number): number {
  const trimmed = nonBlank(value);
  if (trimmed === undefined) return fallback;
  const parsed = Number(trimmed);
  if (!/^\d+$/.test(trimmed) || parsed < minimum || parsed > MAX_TIMER_MS) {
    throw new Error(`${name} must be an integer between ${minimum} and ${MAX_TIMER_MS}; got "${value}"`);
  }
  return parsed;
}
