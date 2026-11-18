import type { CapturePhase } from '../../../../domain/catalog-capture.js';

/**
 * Minutes each capture phase takes. PROVISIONAL until the build-4069 live measurement
 * (plan 3 Task 1) replaces them.
 */
export const PHASE_MINUTES: Readonly<Record<CapturePhase, number>> = {
  discover: 1,
  enum: 6,
  sample: 4,
  probe: 278,
  validate: 0,
  install: 0,
};

/** Whole-run estimates per mode, derived from `PHASE_MINUTES`. */
export const CAPTURE_MINUTES = {
  short: PHASE_MINUTES.discover + PHASE_MINUTES.enum + PHASE_MINUTES.sample,
  full: PHASE_MINUTES.discover + PHASE_MINUTES.enum + PHASE_MINUTES.probe,
} as const;
