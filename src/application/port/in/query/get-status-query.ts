import type { SessionSummary } from '../../../../domain/session.js';

export type GetStatusQuery = Readonly<Record<string, never>>;

export type StatusView = {
  readonly configured: boolean;
  readonly executable: string | null;
  readonly build?: number;
  readonly buildName?: string;
  readonly session: SessionSummary;
};

export interface GetStatusQueryPort {
  getStatus(query: GetStatusQuery): Promise<StatusView>;
}
