import { WorldMachineError } from '../../../../domain/errors.js';

/** The first 20 output lines as an error payload, or none for an empty output. */
export function outputPayload(lines: readonly string[]): string | undefined {
  return lines.slice(0, 20).join('\n') || undefined;
}

export function unexpectedOutput(what: string, lines: readonly string[]): WorldMachineError {
  return new WorldMachineError(
    'UNEXPECTED_OUTPUT',
    `Could not parse World Machine output for ${what}. This World Machine build may format it differently.`,
    lines.slice(0, 20).join('\n'),
  );
}
