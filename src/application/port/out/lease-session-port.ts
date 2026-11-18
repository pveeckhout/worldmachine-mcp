import type { RawResponse } from '../../../adapter/out/worldmachine/raw-response.js';

/** The session, held by one long job. Every other caller is refused with CAPTURING until `release()`. */
export interface SessionLease {
  execute(commands: readonly string[], timeoutMs?: number): Promise<readonly RawResponse[]>;
  /** Binds a fresh, clean project after `project new blank force`. */
  bindFresh(): void;
  /** Gives the session back; calling it again does nothing. */
  release(): void;
}

export interface LeaseSessionPort {
  /**
   * Takes the session for one long job. `busy` words the CAPTURING refusal every other caller gets.
   * Throws REFUSED while another call is in flight or exclusive work runs, and CAPTURING while a lease is held.
   */
  lease(busy: () => string): SessionLease;
}
