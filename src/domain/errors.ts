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
