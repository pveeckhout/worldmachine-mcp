import type { ConsoleReply } from '../../../application/port/out/lease-session-port.js';
import { WorldMachineError } from '../../../domain/errors.js';

export type RawResponse = ConsoleReply;

export function throwIfFailed(response: RawResponse): void {
  if (response.errors.length > 0) {
    throw new WorldMachineError(
      'WM_COMMAND_FAILED',
      `World Machine rejected "${response.command}"`,
      response.errors.join('\n'),
    );
  }
}

export function requireFrame(response: RawResponse | undefined): RawResponse {
  if (response === undefined) {
    throw new WorldMachineError('UNEXPECTED_OUTPUT', 'World Machine returned no response for a command');
  }
  return response;
}
