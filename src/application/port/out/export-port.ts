import type { ExportTarget } from '../../../domain/output-template.js';

/** Exports (spec v2a sections 4-5). Callers check every target's path before `exportAll`. */
export interface ExportPort {
  /** `export list`: every output with its file name template (fact 49). */
  targets(): Promise<ExportTarget[]>;
  /** `export all`: writes every output and returns the paths World Machine reports (fact 50). */
  exportAll(): Promise<string[]>;
}
