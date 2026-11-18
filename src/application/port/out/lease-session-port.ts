/** One console command and what World Machine answered to it. */
export type ConsoleReply = {
  readonly command: string;
  readonly output: readonly string[];
  readonly errors: readonly string[];
};

/** The session, held by one long job. Every other caller is refused with CAPTURING until `release()`. */
export interface SessionLease {
  /**
   * A crash or exit of World Machine ends the lease: the next `execute` rejects with CRASHED and never starts World
   * Machine again. The holder treats CRASHED as terminal, releases, and ends its run.
   */
  execute(commands: readonly string[], timeoutMs?: number): Promise<readonly ConsoleReply[]>;
  /** Binds a fresh, clean project after `project new blank force`. */
  bindFresh(): void;
  /** Gives the session back; calling it again does nothing. */
  release(): void;
}

export interface LeaseSessionPort {
  /**
   * Takes the session for one long job. `busy` words the CAPTURING refusal every other caller gets.
   * Throws REFUSED while another call is in flight, exclusive work runs, or a build runs, and CAPTURING while a lease is held.
   */
  lease(busy: () => string): SessionLease;
}
