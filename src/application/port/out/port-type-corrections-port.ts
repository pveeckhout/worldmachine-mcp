import type { WireVerdict } from '../../../domain/catalog.js';

export interface PortTypeCorrectionsPort {
  /** undefined when the build has no corrections, or its file failed to load. */
  correctionsFor(build: number): ReadonlyMap<string, WireVerdict> | undefined;
  /** One line per corrections file that failed to load: path and reason. */
  problems(): readonly string[];
}
