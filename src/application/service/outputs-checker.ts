import { checkOutputs, type OutputsCheck } from '../../domain/build-result.js';
import { WorldMachineError } from '../../domain/errors.js';
import type { BuildResultPort } from '../port/out/build-result-port.js';
import type { ExportPort } from '../port/out/export-port.js';
import type { ProjectGraphReadPort } from '../port/out/project-graph-read-port.js';
import type { WorldMachineSessionPort } from '../port/out/world-machine-session-port.js';
import { readOutputChains } from './output-chains.js';

/** Build-not-built design sections 5 and 6: the check's result, or why the check failed. */
export type OutputsCheckOutcome = OutputsCheck | { readonly outputsCheckError: string };

/**
 * A guarded check's result (plan decision D7): the outcome; the guard's own value when it stopped the check before
 * any read; or `refused` when exclusive() itself was refused, before the guard ran (Codex round 2 ruling 1b).
 */
export type GuardedOutcome<T> =
  | { readonly kind: 'checked'; readonly outcome: OutputsCheckOutcome }
  | { readonly kind: 'stopped'; readonly value: T }
  | { readonly kind: 'refused' };

/**
 * Build-not-built design sections 4-6, shared by build_project and get_build_status (build-status-check design
 * section 4): whether every configured output has a result at the scene resolution and where building stopped. Its
 * own exclusive() action (build-not-built plan decision B1). A WorldMachineError becomes outputsCheckError (B9); any
 * other error is a bug and propagates.
 */
export class OutputsChecker {
  readonly #session: WorldMachineSessionPort;
  readonly #exports: ExportPort;
  readonly #graph: ProjectGraphReadPort;
  readonly #results: BuildResultPort;

  constructor(
    session: WorldMachineSessionPort,
    exports: ExportPort,
    graph: ProjectGraphReadPort,
    results: BuildResultPort,
  ) {
    this.#session = session;
    this.#exports = exports;
    this.#graph = graph;
    this.#results = results;
  }

  /** build_project: a refused exclusive() is reported as outputsCheckError too (build-not-built plan decision B9). */
  async check(): Promise<OutputsCheckOutcome> {
    try {
      return await this.#session.exclusive(() => this.#read());
    } catch (error) {
      if (!(error instanceof WorldMachineError)) throw error;
      return { outputsCheckError: error.message };
    }
  }

  /**
   * get_build_status (plan decision D7): `guard` runs first inside the section, and a value other than undefined
   * stops the check before any read. Assumed (Codex round 2 ruling 2): no step of the reads yields to the event loop
   * except session.execute, whose in-flight batch a World Machine exit or TIMEOUT rejects (command-queue.ts l.46 and
   * l.94, world-machine-session.ts l.154-155), so a read cannot start World Machine again after the guard passed.
   */
  async checkGuarded<T>(guard: () => T | undefined): Promise<GuardedOutcome<T>> {
    let entered = false;
    try {
      return await this.#session.exclusive(async (): Promise<GuardedOutcome<T>> => {
        entered = true;
        const value = guard();
        if (value !== undefined) return { kind: 'stopped', value };
        return { kind: 'checked', outcome: await this.#read() };
      });
    } catch (error) {
      if (!(error instanceof WorldMachineError)) throw error;
      // Codex round 2 ruling 1b: exclusive() itself refused (a build runs, or a shutdown began); nothing is stored.
      if (!entered) return { kind: 'refused' };
      return { kind: 'checked', outcome: { outputsCheckError: error.message } };
    }
  }

  /** Section 4: the reads, inside the caller's exclusive() section. */
  async #read(): Promise<OutputsCheck> {
    // Section 4 step 2: the timing of every listed device, before any read that selects a device. Plan decision B12:
    // no outputs, no batch (readOutputChains does not call back then).
    let built = new Set<number>();
    const chains = await readOutputChains(this.#exports, this.#graph, async (ids) => {
      built = new Set(await this.#results.builtDevices(ids));
    });
    return checkOutputs(chains.graph, built, chains.outputs);
  }
}
