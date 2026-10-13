import type { BuildRun } from '../../domain/build.js';
import type { GuardedOutcome, OutputsCheckOutcome } from './outputs-checker.js';

/** Build-status-check design section 3, verbatim. */
export const PROJECT_CHANGED = 'The project changed after the build ended; run build_project again.';
/** Section 3, verbatim. */
export const RESULTS_GONE =
  'World Machine is not running; the results of that build are gone. Run build_project again.';

/** The run a record belongs to, and the session as that run started (plan decisions D4 and D9). */
export type FullBuildStamp = {
  /** The run's `startedAt`, as the build tracker stamped it. */
  readonly startedAt: number;
  /** `status().generation`: the World Machine process the run belongs to (Codex round 2 ruling 1a). */
  readonly generation: number | undefined;
  readonly revision: number;
  readonly switches: number;
};
/** Section 3, `awaiting`: a full build that outlived build_project's wait. */
export type AwaitingFullBuild = FullBuildStamp & { readonly state: 'awaiting' };
/** Section 3, `checking`: its check is running; concurrent calls share it. */
export type CheckingFullBuild = FullBuildStamp & { readonly state: 'checking' };
/** Section 3, `checked`: the result, repeated by later calls. */
export type CheckedFullBuild = FullBuildStamp & {
  readonly state: 'checked';
  readonly result: OutputsCheckOutcome;
};
export type LastFullBuild = AwaitingFullBuild | CheckingFullBuild | CheckedFullBuild;

/** What get_build_status sees: the tracker's last run, the process, the session's counters, and its readiness. */
export type BuildObservation = {
  readonly last: BuildRun | undefined;
  readonly generation: number | undefined;
  readonly revision: number;
  readonly switches: number;
  readonly ready: boolean;
};

export type LastFullBuildStep =
  | { readonly kind: 'clear' }
  | { readonly kind: 'keep' }
  | { readonly kind: 'check'; readonly entry: AwaitingFullBuild }
  | { readonly kind: 'skip'; readonly entry: AwaitingFullBuild; readonly outputsCheckError: string };
/** A step that ends a due check before any read (plan decision D7). */
export type StopStep = Exclude<LastFullBuildStep, { readonly kind: 'check' }>;
/** OutputsChecker.checkGuarded, as the record calls it. */
export type GuardedCheck = (guard: () => StopStep | undefined) => Promise<GuardedOutcome<StopStep>>;

/**
 * Section 3, the table: what get_build_status does with the record. Pure, and the only place the rows are ordered
 * (plan decision D8); the check's guard runs it again inside the exclusive() section (D7).
 */
export function nextLastFullBuildStep(
  entry: LastFullBuild | undefined,
  seen: BuildObservation,
): LastFullBuildStep {
  if (entry === undefined) return { kind: 'keep' };
  // A bind() to another project (plan decision D2): cleared, in every state.
  if (seen.switches !== entry.switches) return { kind: 'clear' };
  const last = seen.last;
  // The record's run: its startedAt in its World Machine process (Codex round 2 ruling 1a). Any other run (a new
  // build of any tracked mode, in this or a new process) clears the record, in every state.
  if (last !== undefined && (last.startedAt !== entry.startedAt || seen.generation !== entry.generation)) {
    return { kind: 'clear' };
  }
  // A checked result is repeated, also once its run vanished with World Machine (Revision 2); a running check is shared.
  if (entry.state !== 'awaiting') return { kind: 'keep' };
  // No run: World Machine exited after the build, or a relaunched process has none yet; the results went with it.
  if (last === undefined) return { kind: 'skip', entry, outputsCheckError: RESULTS_GONE };
  if (last.state === 'running') return { kind: 'keep' };
  // The results are gone before the project counts as changed (D8).
  if (!seen.ready) return { kind: 'skip', entry, outputsCheckError: RESULTS_GONE };
  if (seen.revision !== entry.revision) return { kind: 'skip', entry, outputsCheckError: PROJECT_CHANGED };
  return { kind: 'check', entry };
}

/**
 * Section 6: the record of the last full build that build_project started. One instance is shared by build_project
 * and get_build_status (main.ts).
 */
export class LastFullBuildRecord {
  #entry: LastFullBuild | undefined;
  #pending: Promise<CheckedFullBuild | undefined> | undefined;

  /** build_project: a full build that finished within the wait, with the result it returned. */
  finished(stamp: FullBuildStamp, result: OutputsCheckOutcome): void {
    this.#entry = { ...stamp, state: 'checked', result };
    this.#pending = undefined;
  }

  /** build_project: a full build that outlived the wait (`running`). */
  outlived(stamp: FullBuildStamp): void {
    this.#entry = { ...stamp, state: 'awaiting' };
    this.#pending = undefined;
  }

  /**
   * get_build_status: the checked last full build, or undefined. Runs the check when one is due (section 4), and a
   * call during a running check shares it. An error from the check fails every call that shares it, and the record
   * goes back to `awaiting` (plan decision D11).
   */
  resolve(observe: () => BuildObservation, check: GuardedCheck): Promise<CheckedFullBuild | undefined> {
    const entry = this.#entry;
    const step = nextLastFullBuildStep(entry, observe());
    if (step.kind === 'check') {
      const pending = this.#check(step.entry, observe, check);
      this.#pending = pending;
      return pending;
    }
    if (step.kind === 'keep') {
      if (entry?.state === 'checked') return Promise.resolve(entry);
      if (entry?.state === 'checking' && this.#pending !== undefined) return this.#pending;
      return Promise.resolve(undefined);
    }
    return Promise.resolve(this.#apply(step));
  }

  /** Clears the record, or stores why the check reads nothing. */
  #apply(step: Exclude<StopStep, { readonly kind: 'keep' }>): CheckedFullBuild | undefined {
    if (step.kind === 'clear') {
      this.#entry = undefined;
      this.#pending = undefined;
      return undefined;
    }
    return this.#store(step.entry, { outputsCheckError: step.outputsCheckError });
  }

  #store(entry: AwaitingFullBuild, result: OutputsCheckOutcome): CheckedFullBuild {
    const checked: CheckedFullBuild = { ...entry, state: 'checked', result };
    this.#entry = checked;
    this.#pending = undefined;
    return checked;
  }

  /** Back to `awaiting`: the next call decides again. */
  #restore(entry: AwaitingFullBuild): undefined {
    this.#entry = entry;
    this.#pending = undefined;
    return undefined;
  }

  async #check(
    entry: AwaitingFullBuild,
    observe: () => BuildObservation,
    check: GuardedCheck,
  ): Promise<CheckedFullBuild | undefined> {
    const checking: CheckingFullBuild = { ...entry, state: 'checking' };
    this.#entry = checking;
    // Plan decision D7: inside the section, the same step on a fresh observation; only a step still `check` reads.
    const guard = (): StopStep | undefined => {
      const step = nextLastFullBuildStep(entry, observe());
      return step.kind === 'check' ? undefined : step;
    };
    let outcome: GuardedOutcome<StopStep>;
    try {
      outcome = await check(guard);
    } catch (error) {
      if (this.#entry === checking) this.#restore(entry);
      throw error;
    }
    // Plan decision D10: build_project wrote a newer entry while the check ran; that one stands.
    if (this.#entry !== checking) return undefined;
    switch (outcome.kind) {
      case 'checked':
        return this.#store(entry, outcome.outcome);
      case 'refused':
        // Codex round 2 ruling 1b: exclusive() was refused (a build runs); nothing is stored for this run.
        return this.#restore(entry);
      case 'stopped':
        // `keep` means the run shows as running again; the record waits.
        return outcome.value.kind === 'keep' ? this.#restore(entry) : this.#apply(outcome.value);
    }
  }
}
