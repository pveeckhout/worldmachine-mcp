import type { CapturePhase } from '../../../../domain/catalog-capture.js';

/**
 * Minutes each capture phase takes on build 4069.
 *
 * - enum: measured 2026-11-19, `node scripts/capture-fixtures.mjs enum-options` took 206.76 s.
 * - sample: the `(timing)` of test/fixtures/wm-4069/raw/port-types-sample.txt, adding and listing 36 s plus lean
 *   probing 178 s.
 * - probe: the full 4067 port-types run, 1 min of adding and listing plus 277 min of probing.
 * - discover: not measured separately; a single `device add` sweep, estimated at 1 min.
 */
export const PHASE_MINUTES: Readonly<Record<CapturePhase, number>> = {
  discover: 1,
  enum: 206.76 / 60,
  sample: (36 + 178) / 60,
  probe: 1 + 277,
  validate: 0,
  install: 0,
};

/** Whole-run estimates per mode in whole minutes, rounded up, derived from `PHASE_MINUTES`. */
export const CAPTURE_MINUTES = {
  short: Math.ceil(PHASE_MINUTES.discover + PHASE_MINUTES.enum + PHASE_MINUTES.sample),
  full: Math.ceil(PHASE_MINUTES.discover + PHASE_MINUTES.enum + PHASE_MINUTES.probe),
} as const;
