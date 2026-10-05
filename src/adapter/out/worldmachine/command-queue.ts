import { randomBytes } from 'node:crypto';
import { WorldMachineError } from '../../../domain/errors.js';
import type { Logger } from '../../../logger.js';
import type { CommandChannel } from './channel.js';
import { sentinel } from './command-builder.js';
import { FrameAssembler } from './frame-assembler.js';
import type { RawResponse } from './raw-response.js';

export type QueueOptions = {
  readonly timeoutMs: number;
  readonly nudgeMs?: number;
  readonly newBatchId?: () => string;
  /** Receives the original cause of a wrapped write failure; never sent to clients. */
  readonly logger?: Logger;
};

const DEFAULT_NUDGE_MS = 100;

type ActiveBatch = {
  readonly assembler: FrameAssembler;
  readonly resolve: (responses: readonly RawResponse[]) => void;
  readonly reject: (error: WorldMachineError) => void;
  readonly timer: NodeJS.Timeout;
  readonly nudge: NodeJS.Timeout | undefined;
};

/** One batch in flight at a time; batches run as transactions (spec section 5.1). */
export class CommandQueue {
  readonly #channel: CommandChannel;
  readonly #timeoutMs: number;
  readonly #nudgeMs: number;
  readonly #newBatchId: () => string;
  readonly #logger: Logger | undefined;
  #tail: Promise<unknown> = Promise.resolve();
  #active: ActiveBatch | undefined;
  #closed: WorldMachineError | undefined;
  #draining: WorldMachineError | undefined;

  constructor(channel: CommandChannel, options: QueueOptions) {
    this.#channel = channel;
    this.#timeoutMs = options.timeoutMs;
    this.#nudgeMs = options.nudgeMs ?? DEFAULT_NUDGE_MS;
    this.#newBatchId = options.newBatchId ?? (() => randomBytes(4).toString('hex'));
    this.#logger = options.logger;
    channel.onLine((line) => this.#onLine(line));
    channel.onExit(() => this.#close(new WorldMachineError('CRASHED', 'World Machine exited unexpectedly')));
  }

  execute(commands: readonly string[]): Promise<readonly RawResponse[]> {
    if (this.#draining) return Promise.reject(this.#draining);
    const result = this.#tail.then(() => this.#run(commands));
    this.#tail = result.catch(() => undefined);
    return result;
  }

  async drain(reason: WorldMachineError): Promise<void> {
    this.#draining ??= reason;
    await this.#tail;
  }

  /** Refuses queued batches and fails the running one with `reason`; used when a shutdown's drain time is up. */
  abort(reason: WorldMachineError): void {
    this.#draining ??= reason;
    this.#close(reason);
  }

  #run(commands: readonly string[]): Promise<readonly RawResponse[]> {
    if (this.#closed) return Promise.reject(this.#closed);
    if (commands.length === 0) return Promise.resolve([]);
    return new Promise((resolve, reject) => {
      const batchId = this.#newBatchId();
      const timer = setTimeout(
        () =>
          this.#close(
            new WorldMachineError('TIMEOUT', `World Machine did not answer within ${this.#timeoutMs} ms`),
          ),
        this.#timeoutMs,
      );
      // World Machine reads only the first new line per stdin read; empty lines make it read the rest.
      const nudge = this.#nudgeMs > 0 ? setInterval(() => this.#nudge(), this.#nudgeMs) : undefined;
      this.#active = { assembler: new FrameAssembler(batchId, commands), resolve, reject, timer, nudge };
      try {
        this.#channel.write(commands.flatMap((command, index) => [command, sentinel(batchId, index)]));
      } catch (error) {
        // The process has exited but its exit listener has not run yet (output may still be draining). Keep the
        // batch pending: that listener closes the queue with the exit error, which the session maps to lost changes.
        if (error instanceof WorldMachineError && error.code === 'CRASHED') return;
        if (!(error instanceof WorldMachineError)) {
          this.#logger?.debug(
            `Command write failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        // Closing also rejects this batch (it is active) and makes later batches fail with the same error.
        this.#close(
          error instanceof WorldMachineError
            ? error
            : new WorldMachineError('CRASHED', 'World Machine stopped accepting commands'),
        );
      }
    });
  }

  #onLine(line: string): void {
    const active = this.#active;
    if (!active) return;
    if (active.assembler.push(line)) {
      this.#finish();
      active.resolve(active.assembler.responses);
    }
  }

  #nudge(): void {
    try {
      this.#channel.write(['']);
    } catch {
      // The channel has exited; its exit listener closes the queue.
    }
  }

  /** Clears the active batch's timers and detaches it. */
  #finish(): void {
    const active = this.#active;
    if (!active) return;
    clearTimeout(active.timer);
    if (active.nudge) clearInterval(active.nudge);
    this.#active = undefined;
  }

  #close(error: WorldMachineError): void {
    this.#closed ??= error;
    const active = this.#active;
    if (!active) return;
    this.#finish();
    active.reject(error);
  }
}
