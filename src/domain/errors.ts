export type ErrorCode =
  | 'NOT_CONFIGURED'
  | 'START_FAILED'
  | 'REFUSED'
  | 'WM_COMMAND_FAILED'
  | 'TIMEOUT'
  | 'CRASHED'
  | 'UNEXPECTED_OUTPUT'
  | 'SHUTTING_DOWN'
  | 'APPLY_FAILED';

export class WorldMachineError extends Error {
  readonly code: ErrorCode;
  readonly worldMachineMessage: string | undefined;
  /** Fields a failure result carries beside code and message (plan v3 decision D17), such as APPLY_FAILED's. */
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(
    code: ErrorCode,
    message: string,
    worldMachineMessage?: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'WorldMachineError';
    this.code = code;
    this.worldMachineMessage = worldMachineMessage;
    this.details = details;
  }
}

// Spec section 8: World Machine text in a tool result never carries log lines or licence lines. The rule lives here,
// beside the error type whose field it governs, so the MCP adapter and the World Machine adapter share it.
/** A World Machine log line: `[Level     ] text`. Group 1 is the level. */
export const LOG_LINE = /^\[([A-Za-z]+)\s*\] /;
/** World Machine licence text; never allowed into a tool result or a log line. */
export const LICENCE = /licen[cs]e/i;

/** World Machine's lines as a result may carry them: log and licence lines removed; undefined when none remain. */
export function worldMachineText(lines: readonly string[]): string | undefined {
  const kept = lines.filter((line) => !LOG_LINE.test(line) && !LICENCE.test(line));
  return kept.length > 0 ? kept.join('\n') : undefined;
}
