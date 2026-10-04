import type { SessionSummary } from '../../../domain/session.js';
import type { SystemInfo } from '../../../domain/system-info.js';

export type SessionStatus = {
  readonly executable: string | null;
  readonly session: SessionSummary;
  readonly systemInfo?: SystemInfo;
};

export interface WorldMachineSessionPort {
  ensureRunning(): Promise<void>;
  status(): SessionStatus;
  shutdown(): Promise<void>;
}
