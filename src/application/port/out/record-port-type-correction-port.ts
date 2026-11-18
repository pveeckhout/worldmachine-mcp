import type { PortTypeCorrection } from '../../../domain/catalog.js';

export interface RecordPortTypeCorrectionPort {
  /** Throws when the build's corrections file failed to load, or the write fails. */
  record(correction: PortTypeCorrection): void;
}
