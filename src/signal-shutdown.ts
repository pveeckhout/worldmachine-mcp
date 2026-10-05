import type { Logger } from './logger.js';

export type SignalShutdownOptions = {
  /** Runs the graceful shutdown; `reason` is the signal name or `stdin closed`. */
  readonly stop: (reason: string) => Promise<void>;
  /** SIGKILLs World Machine; resolves once it is gone. */
  readonly kill: () => Promise<void>;
  readonly exit: (code: number) => void;
  readonly logger: Logger;
  /** How long a repeated signal waits for `kill` before exiting 1 anyway. */
  readonly boundMs: number;
};

export type SignalShutdown = {
  /** The first call starts the graceful shutdown; a later call SIGKILLs World Machine and exits. */
  trigger(reason: string): void;
};

/**
 * Spec section 9: the server exits 0 once World Machine is gone, even if a shutdown step fails. A repeated trigger
 * means the graceful shutdown is stuck (or the SDK's stdin end is followed by its SIGTERM): kill World Machine and
 * exit within `boundMs`, with code 1 only when the kill is not confirmed by then.
 */
export function createSignalShutdown(options: SignalShutdownOptions): SignalShutdown {
  let stopping = false;
  return {
    trigger(reason) {
      if (!stopping) {
        stopping = true;
        options.logger.debug(`Stopping: ${reason}`);
        void options
          .stop(reason)
          .catch((error: unknown) => options.logger.error(`Shutdown failed: ${String(error)}`))
          .finally(() => options.exit(0));
        return;
      }
      let timer: NodeJS.Timeout | undefined;
      const bound = new Promise<number>((resolve) => {
        timer = setTimeout(() => resolve(1), options.boundMs);
      });
      // Only a kill that resolves confirms World Machine is gone; a failed kill exits 1 like a timeout.
      const killed = options.kill().then(
        () => 0,
        (error: unknown) => {
          options.logger.error(`Kill failed: ${String(error)}`);
          return 1;
        },
      );
      void Promise.race([killed, bound]).then((code) => {
        clearTimeout(timer);
        options.exit(code);
      });
    },
  };
}
