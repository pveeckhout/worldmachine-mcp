import type { RawResponse } from '../../src/adapter/out/worldmachine/raw-response.js';
import type { WorldMachineSession } from '../../src/adapter/out/worldmachine/world-machine-session.js';

/** One scripted answer: output lines and `Error:` lines, copied from a capture. */
export type Reply = { readonly output?: readonly string[]; readonly errors?: readonly string[] };

/**
 * A stand-in for WorldMachineSession that answers each command with the next reply scripted for its exact text, and
 * records every batch and every markDirty call. A command without a remaining reply rejects the batch, so a test
 * fails when the adapter sends something it did not expect.
 */
export function scriptedSession(script: Readonly<Record<string, readonly Reply[]>>) {
  const queues = new Map(Object.entries(script).map(([command, replies]) => [command, [...replies]]));
  const batches: string[][] = [];
  let dirtyMarks = 0;
  const execute = async (commands: readonly string[]): Promise<RawResponse[]> => {
    batches.push([...commands]);
    return commands.map((command) => {
      const reply = queues.get(command)?.shift();
      if (reply === undefined) throw new Error(`unscripted command: ${command}`);
      return { command, output: reply.output ?? [], errors: reply.errors ?? [] };
    });
  };
  const session = {
    assertAcceptingCalls: () => undefined,
    execute,
    executeOne: async (command: string) => (await execute([command]))[0],
    markDirty: () => {
      dirtyMarks++;
    },
  };
  return {
    session: session as unknown as WorldMachineSession,
    batches,
    dirtyMarks: () => dirtyMarks,
  };
}
