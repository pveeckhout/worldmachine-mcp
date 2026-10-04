import type { WorldMachineError } from '../../../domain/errors.js';
import type { SessionSummary } from '../../../domain/session.js';

export function success(view: object) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(view) }],
    structuredContent: view as Record<string, unknown>,
  };
}

const LICENCE = /licen[cs]e/i;

export function failure(error: WorldMachineError, session: SessionSummary) {
  // Last line of defence: licence text never leaves the server, whatever produced the error.
  const worldMachineMessage = error.worldMachineMessage
    ?.split('\n')
    .filter((line) => !LICENCE.test(line))
    .join('\n');
  const payload = {
    code: error.code,
    message: error.message,
    ...(worldMachineMessage ? { worldMachineMessage } : {}),
    session,
  };
  return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(payload) }] };
}
