import type { ExportTarget } from '../../../domain/output-template.js';

/** Exports (spec v2a sections 4-5). Callers check every target's path before `exportAll`. */
export interface ExportPort {
  /** `export list`: every output with its file name template (fact 49). */
  targets(): Promise<ExportTarget[]>;
  /** `export all`: writes every output and returns the paths World Machine reports (fact 50). */
  exportAll(): Promise<string[]>;
  /**
   * The given output devices whose `exportAlways` is not confirmed off, so a full build may write their files (fact
   * 55). Fails closed: only a device the name resolves to unambiguously that reads `false`, or that has no such
   * parameter (fact 51), counts as off (ruling P-FR-3).
   */
  exportingAlways(devices: readonly string[]): Promise<string[]>;
}
