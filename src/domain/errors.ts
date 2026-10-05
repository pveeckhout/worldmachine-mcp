export type ErrorCode =
  | 'NOT_CONFIGURED'
  | 'START_FAILED'
  | 'REFUSED'
  | 'WM_COMMAND_FAILED'
  | 'TIMEOUT'
  | 'CRASHED'
  | 'UNEXPECTED_OUTPUT'
  | 'SHUTTING_DOWN';

export class WorldMachineError extends Error {
  readonly code: ErrorCode;
  readonly worldMachineMessage: string | undefined;

  constructor(code: ErrorCode, message: string, worldMachineMessage?: string) {
    super(message);
    this.name = 'WorldMachineError';
    this.code = code;
    this.worldMachineMessage = worldMachineMessage;
  }
}

// Spec section 8: World Machine text in a tool result never carries log lines or licence lines. The rule lives here,
// beside the error type whose field it governs, so the MCP adapter and the World Machine adapter share it.
const LOG_LINE = /^\[[A-Za-z]+\s*\] /;
const LICENCE = /licen[cs]e/i;

/** World Machine's lines as a result may carry them: log and licence lines removed; undefined when none remain. */
export function worldMachineText(lines: readonly string[]): string | undefined {
  const kept = lines.filter((line) => !LOG_LINE.test(line) && !LICENCE.test(line));
  return kept.length > 0 ? kept.join('\n') : undefined;
}
