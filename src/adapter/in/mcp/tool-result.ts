import { type WorldMachineError, worldMachineText } from '../../../domain/errors.js';
import type { SessionSummary } from '../../../domain/session.js';

export function success(view: object) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(view) }],
    structuredContent: view as Record<string, unknown>,
  };
}

export function failure(error: WorldMachineError, session: SessionSummary) {
  // Last line of defence: licence and log text never leave the server, whatever produced the error (spec section 8).
  const worldMachineMessage =
    error.worldMachineMessage === undefined
      ? undefined
      : worldMachineText(error.worldMachineMessage.split('\n'));
  const payload = {
    code: error.code,
    message: error.message,
    ...(worldMachineMessage ? { worldMachineMessage } : {}),
    session,
  };
  return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(payload) }] };
}
