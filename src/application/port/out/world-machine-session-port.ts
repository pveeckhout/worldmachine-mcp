import type { SessionSummary } from '../../../domain/session.js';
import type { SystemInfo } from '../../../domain/system-info.js';

export type SessionStatus = {
  readonly executable: string | null;
  readonly session: SessionSummary;
  readonly systemInfo?: SystemInfo;
  /**
   * Increases each time a World Machine process becomes the session's current one. Set by WorldMachineSession; stubs
   * may omit it. It tells a silent restart (same state, same binding, new process) from the same session.
   */
  readonly generation?: number;
};

export interface WorldMachineSessionPort {
  ensureRunning(): Promise<void>;
  status(): SessionStatus;
  shutdown(): Promise<void>;
  /** Clears the remembered reopen path, so the next start opens the default project instead (spec section 6). */
  forgetReopen(): void;
  /** Runs command use cases one at a time: checks and commands of one never interleave with another's. */
  exclusive<T>(action: () => Promise<T>): Promise<T>;
}
