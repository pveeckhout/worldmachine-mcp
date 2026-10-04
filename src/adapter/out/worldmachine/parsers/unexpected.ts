import { WorldMachineError } from '../../../../domain/errors.js';

export function unexpectedOutput(what: string, lines: readonly string[]): WorldMachineError {
  return new WorldMachineError(
    'UNEXPECTED_OUTPUT',
    `Could not parse World Machine output for ${what}. This World Machine build may format it differently.`,
    lines.slice(0, 20).join('\n'),
  );
}
