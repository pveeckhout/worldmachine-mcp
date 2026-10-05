import { LICENCE } from './domain/errors.js';

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const RANK: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

export interface Logger {
  error(message: string): void;
  warn(message: string): void;
  info(message: string): void;
  debug(message: string): void;
  /** World Machine's own log lines, mapped onto our levels. Licence lines are dropped. */
  worldMachine(level: string, text: string): void;
}

export function isLogLevel(value: string): value is LogLevel {
  return Object.hasOwn(RANK, value);
}

export function createLogger(
  level: LogLevel,
  write: (chunk: string) => void = (chunk) => {
    process.stderr.write(chunk);
  },
): Logger {
  const emit = (at: LogLevel, message: string) => {
    if (RANK[at] > RANK[level]) return;
    // Spec section 8: licence lines never reach the log, whichever method or caller produced them.
    const kept = message.split('\n').filter((line) => !LICENCE.test(line));
    if (kept.length > 0) write(`[worldmachine-mcp] ${at}: ${kept.join('\n')}\n`);
  };
  return {
    error: (message) => emit('error', message),
    warn: (message) => emit('warn', message),
    info: (message) => emit('info', message),
    debug: (message) => emit('debug', message),
    worldMachine(wmLevel, text) {
      if (LICENCE.test(text)) return;
      const at: LogLevel =
        wmLevel === 'error'
          ? 'error'
          : wmLevel === 'warning'
            ? 'warn'
            : wmLevel === 'info'
              ? 'info'
              : 'debug';
      emit(at, `wm: ${text}`);
    },
  };
}
