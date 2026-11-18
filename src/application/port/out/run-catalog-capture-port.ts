import type { DeviceDiscovery, EnumCatalog, PortTypeCatalog, SampleCheck } from '../../../domain/catalog.js';
import type { CaptureMode, CaptureProgress } from '../../../domain/catalog-capture.js';
import type { SessionLease } from './lease-session-port.js';

export type CaptureRun = {
  readonly build: number;
  readonly mode: CaptureMode;
  /** From closestStrictBase. short: the catalog the sample is checked against. full: the class names' reference. */
  readonly base?: PortTypeCatalog;
  /** Discovery's seeds; the add words are also the port-type phase's words. */
  readonly known: { readonly addWords: readonly string[]; readonly typeNames: readonly string[] };
  /** `<catalogDir>/<build>/.capture-<mode>`: the transcripts, kept until an install, so a later run resumes them. */
  readonly workDir: string;
};

export type CaptureResult = {
  readonly enumOptions: EnumCatalog;
  /** short: the sample check. full: the parsed catalog, its classes named. */
  readonly portTypes: SampleCheck | { readonly agreed: true; readonly catalog: PortTypeCatalog };
  readonly discovery: DeviceDiscovery;
  /** Words the enum capture could not add. */
  readonly refusedWords: readonly string[];
};

export interface RunCatalogCapturePort {
  /**
   * Drives World Machine through the lease and parses what it captured; nothing is installed. Rejects with the
   * signal's reason once `signal` aborts (checked between batches), and with CRASHED when World Machine ends. Either
   * way the transcript stays in `workDir` and the next run of the same build and mode resumes it.
   */
  run(
    run: CaptureRun,
    lease: SessionLease,
    onProgress: (progress: CaptureProgress) => void,
    signal: AbortSignal,
  ): Promise<CaptureResult>;
}
