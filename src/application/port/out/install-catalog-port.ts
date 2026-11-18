import type { DeviceType, EnumCatalog, PortTypeCatalog } from '../../../domain/catalog.js';
import type { CaptureMode } from '../../../domain/catalog-capture.js';

export type CaptureRecord = {
  readonly mode: CaptureMode;
  readonly date: string;
  readonly serverVersion: string;
  readonly baseBuild?: number;
  /** `'agreed'`, or the disagreement the sample found. */
  readonly sampleCheck?: 'agreed' | string;
  readonly notCaptured: readonly string[];
  readonly untypedTypes: readonly string[];
  readonly discoveryIncomplete: boolean;
  readonly deviceTypes: readonly DeviceType[];
};

export type CatalogInstall = {
  readonly build: number;
  readonly enumOptions?: EnumCatalog;
  readonly portTypes?: PortTypeCatalog;
  readonly record: CaptureRecord;
};

export interface InstallCatalogPort {
  /**
   * Validates, then installs. Throws Error naming the first failed check; nothing live changes then.
   * A failed validation changes nothing. The install itself is atomic per file, not across files: a failure midway can
   * leave the new enum catalog beside the old port-type catalog, and installing again completes it.
   */
  install(entry: CatalogInstall, runningBuild: number): void;
}
