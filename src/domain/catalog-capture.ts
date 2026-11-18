import type { CatalogSource } from './catalog.js';

/** `short` samples the port types against a strict base catalog; `full` wires every output to every input. */
export type CaptureMode = 'short' | 'full';

export type CapturePhase = 'discover' | 'enum' | 'sample' | 'probe' | 'validate' | 'install';

export type CaptureOutcome =
  | {
      readonly kind: 'installed';
      readonly installed: readonly ('enum-options' | 'port-types')[];
      readonly notes: readonly string[];
    }
  | {
      readonly kind: 'sample-disagreed';
      readonly disagreement: string;
      readonly installed: readonly 'enum-options'[];
      readonly notes: readonly string[];
    }
  | { readonly kind: 'failed'; readonly reason: string }
  | { readonly kind: 'cancelled' };

export type CaptureProgress = { readonly phase: CapturePhase; readonly done: number; readonly total: number };

/** What a caller sees of a capture: where it is and how long it still needs. */
export type CaptureView = {
  readonly build: number;
  readonly mode: CaptureMode;
  readonly phase: CapturePhase;
  /** Whole percent, 0 to 100. */
  readonly percent: number;
  /** Whole minutes, rounded up; undefined before the first unit is done. */
  readonly minutesLeft: number | undefined;
  readonly outcome?: CaptureOutcome;
};

const PHASES: Readonly<Record<CaptureMode, readonly CapturePhase[]>> = {
  short: ['discover', 'enum', 'sample', 'validate', 'install'],
  full: ['discover', 'enum', 'probe', 'validate', 'install'],
};

const MS_PER_MINUTE = 60_000;

/** One catalog capture run: its phase, progress, time estimate, and outcome. */
export class CatalogCapture {
  private current: CapturePhase = 'discover';
  private done = 0;
  private total = 0;
  /** When this run first reported the current phase with a total; undefined before. */
  private phaseStartedAt: Date | undefined;
  /** The units of the current phase already done at that first report (a resumed run loads them from its transcript). */
  private doneAtPhaseStart = 0;
  private outcome: CaptureOutcome | undefined;

  constructor(
    readonly build: number,
    readonly mode: CaptureMode,
    readonly startedAt: Date,
    private readonly phaseMinutes: Readonly<Record<CapturePhase, number>>,
  ) {}

  /**
   * The phase's clock starts at its first report in this run that has a total, so units loaded from a transcript are
   * not timed. A report with a total of 0 enters the phase while its size is still unknown.
   */
  progress(progress: CaptureProgress, now: Date): void {
    if (!PHASES[this.mode].includes(progress.phase)) {
      throw new Error(`${progress.phase} is not a phase of a ${this.mode} capture`);
    }
    if (progress.phase !== this.current) {
      this.current = progress.phase;
      this.phaseStartedAt = undefined;
    }
    if (this.phaseStartedAt === undefined && progress.total > 0) {
      this.phaseStartedAt = now;
      this.doneAtPhaseStart = progress.done;
    }
    this.done = progress.done;
    this.total = progress.total;
  }

  finish(outcome: CaptureOutcome): void {
    this.outcome = outcome;
  }

  /**
   * Linear in the units of the current phase done in this run, plus the remaining phases' fixed estimates; undefined
   * before this run has done a unit of the phase.
   */
  minutesLeft(now: Date): number | undefined {
    const timed = this.done - this.doneAtPhaseStart;
    if (this.outcome !== undefined || this.phaseStartedAt === undefined || timed <= 0) return undefined;
    const elapsed = Math.max(0, now.getTime() - this.phaseStartedAt.getTime());
    const remainingUnits = Math.max(0, this.total - this.done);
    const currentMs = (elapsed / timed) * remainingUnits;
    return Math.ceil(currentMs / MS_PER_MINUTE + this.minutesAfterCurrent());
  }

  view(now: Date): CaptureView {
    const view: CaptureView = {
      build: this.build,
      mode: this.mode,
      phase: this.current,
      percent: this.percent(),
      minutesLeft: this.minutesLeft(now),
    };
    return this.outcome === undefined ? view : { ...view, outcome: this.outcome };
  }

  private minutesAfterCurrent(): number {
    const phases = PHASES[this.mode];
    const index = phases.indexOf(this.current);
    return phases.slice(index + 1).reduce((sum, phase) => sum + this.phaseMinutes[phase], 0);
  }

  /** 100 only once installed; a cancelled, failed, or disagreed run stops at 99 at most. */
  private percent(): number {
    if (this.outcome?.kind === 'installed') return 100;
    const phases = PHASES[this.mode];
    const index = Math.max(0, phases.indexOf(this.current));
    const all = phases.reduce((sum, phase) => sum + this.phaseMinutes[phase], 0);
    if (all <= 0) return 0;
    const before = phases.slice(0, index).reduce((sum, phase) => sum + this.phaseMinutes[phase], 0);
    const fraction = this.total > 0 ? Math.min(1, this.done / this.total) : 0;
    const percent = ((before + fraction * this.phaseMinutes[this.current]) / all) * 100;
    // Only an install completes a capture: a run that ended otherwise stays below 100.
    return Math.min(this.outcome === undefined ? 100 : 99, Math.max(0, Math.round(percent)));
  }
}

/** Why a capture of this build and mode is pointless, or undefined when it may run. */
export function captureRefusal(
  mode: CaptureMode,
  existing: readonly CatalogSource[],
  build: number,
): string | undefined {
  const own = existing.filter((source) => source.build === build);
  if (own.some((source) => source.kind === 'strict')) {
    return `build ${build} already has a strict catalog; there is nothing to capture`;
  }
  if (mode === 'short' && own.length > 0) {
    return `build ${build} already has a port-type catalog; a short capture cannot improve it, use mode full`;
  }
  return undefined;
}

/** The refusal every World Machine tool gives while a capture runs. */
export function busyMessage(view: CaptureView): string {
  const left = view.minutesLeft === undefined ? '' : `, about ${view.minutesLeft} min left`;
  return `World Machine is capturing the catalog of build ${view.build} (${view.mode}, ${view.phase}, ${view.percent}%${left}); try again later or cancel_catalog_capture`;
}
