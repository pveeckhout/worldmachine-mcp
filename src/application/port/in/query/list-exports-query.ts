import type { CheckedExportTarget } from '../../../../domain/output-template.js';
import type { SessionSummary } from '../../../../domain/session.js';

export type ListExportsQuery = Readonly<Record<string, never>>;
export type ListExportsView = {
  readonly projectFolder: string | null;
  readonly targets: readonly CheckedExportTarget[];
  readonly session: SessionSummary;
};
export interface ListExportsQueryPort {
  listExports(query: ListExportsQuery): Promise<ListExportsView>;
}
