import type { DeviceDetail } from '../../domain/device.js';
import { foldCase } from '../../domain/device-name.js';
import { WorldMachineError, worldMachineText } from '../../domain/errors.js';
import { type DiffEntry, graphDiff } from '../../domain/graph-diff.js';
import { type GraphState, type PlanStep, planGraph, planId } from '../../domain/graph-plan.js';
import { type GraphSpec, validateGraphSpec } from '../../domain/graph-spec.js';
import type { SessionSummary } from '../../domain/session.js';
import type {
  ApplyFailureDetails,
  ApplyGraphCommand,
  ApplyGraphCommandPort,
  ApplyGraphView,
} from '../port/in/command/apply-graph-command.js';
import type { DeviceEditPort } from '../port/out/device-edit-port.js';
import type { ParameterEditPort } from '../port/out/parameter-edit-port.js';
import type { ProjectGraphReadPort } from '../port/out/project-graph-read-port.js';
import type { SnapshotPort } from '../port/out/snapshot-port.js';
import type { WireEditPort } from '../port/out/wire-edit-port.js';
import type { WorldMachineSessionPort } from '../port/out/world-machine-session-port.js';
import { readGraphState } from './read-graph-state.js';

export const APPLY_SNAPSHOT_PREFIX = 'apply_graph ';

export class ApplyGraphService implements ApplyGraphCommandPort {
  readonly #session: WorldMachineSessionPort;
  readonly #graph: ProjectGraphReadPort;
  readonly #devices: DeviceEditPort;
  readonly #wires: WireEditPort;
  readonly #parameters: ParameterEditPort;
  readonly #snapshots: SnapshotPort;

  constructor(
    session: WorldMachineSessionPort,
    graph: ProjectGraphReadPort,
    devices: DeviceEditPort,
    wires: WireEditPort,
    parameters: ParameterEditPort,
    snapshots: SnapshotPort,
  ) {
    this.#session = session;
    this.#graph = graph;
    this.#devices = devices;
    this.#wires = wires;
    this.#parameters = parameters;
    this.#snapshots = snapshots;
  }

  /**
   * Spec v3 section 6, in one exclusive section (which also refuses while a build runs, v2a section 4): plan again,
   * refuse a stale or conflicting plan, apply under a snapshot, restore it when a step fails.
   */
  applyGraph(command: ApplyGraphCommand): Promise<ApplyGraphView> {
    return this.#session.exclusive(async () => {
      const spec = validateGraphSpec(command.spec);
      const state = await readGraphState(spec, this.#graph, this.#session);
      const id = planId(spec, state);
      if (id !== command.planId) {
        throw new WorldMachineError(
          'REFUSED',
          'The project or the spec changed since plan_graph returned this planId; call plan_graph again and show the new plan',
        );
      }
      const plan = planGraph(spec, state);
      if (plan.conflicts.length > 0) {
        const listed = plan.conflicts.map((conflict) => `${conflict.entry}: ${conflict.reason}`).join('; ');
        throw new WorldMachineError(
          'REFUSED',
          `The plan has conflicts; resolve them and plan again: ${listed}`,
        );
      }
      if (plan.steps.length === 0) {
        return { applied: 0, snapshot: null, diff: [], session: this.#session.status().session };
      }
      const snapshot = `${APPLY_SNAPSHOT_PREFIX}${id.slice(0, 12)}`;
      // D15: a snapshot left by a rolled-back apply of the same plan blocks it, with a message saying what to do.
      if ((await this.#snapshots.list()).some((existing) => existing.name === snapshot)) {
        throw new WorldMachineError(
          'REFUSED',
          `A snapshot named '${snapshot}' exists, left by an earlier apply_graph of this plan; inspect or restore it, then remove it with delete_snapshot before applying again`,
        );
      }
      await this.#snapshots.create(snapshot);
      const start = this.#session.status().session;
      const added = new Map<string, number>();
      for (const [index, step] of plan.steps.entries()) {
        try {
          // A World Machine that exited between steps restarts silently on the next command, on another project.
          if (!this.#sameSession(start)) {
            throw new WorldMachineError(
              'CRASHED',
              'World Machine exited before this step; the remaining steps were not sent',
            );
          }
          await this.#run(step, added);
        } catch (error) {
          if (!(error instanceof WorldMachineError)) throw error;
          throw await this.#failed(error, index, plan.steps.length, step, snapshot, spec, id, start);
        }
      }
      const diff = await this.#diff(plan.steps, state, added);
      const kept = command.keepSnapshot || !(await this.#removeSnapshot(snapshot));
      return {
        applied: plan.steps.length,
        snapshot: kept ? snapshot : null,
        diff,
        session: this.#session.status().session,
      };
    });
  }

  /** One step through the edit ports, every device as `#<id>`; `added` maps spec names to the ids adds returned. */
  async #run(step: PlanStep, added: Map<string, number>): Promise<void> {
    const ref = (device: string, id: number | undefined): string => {
      const resolved = id ?? added.get(foldCase(device));
      // planGraph orders adds before every step that uses the added device.
      if (resolved === undefined) throw new Error(`apply_graph: no id for '${device}'`);
      return `#${resolved}`;
    };
    switch (step.op) {
      case 'disconnect':
        await this.#wires.disconnect(
          { device: `#${step.source.id}`, port: step.source.port },
          { device: `#${step.id}`, port: step.port },
        );
        return;
      case 'remove':
        await this.#devices.deleteDevice(`#${step.id}`);
        return;
      case 'add': {
        const row = await this.#devices.addDevice(step.type);
        added.set(foldCase(step.device), row.id);
        // Section 5: renamed only when the default name differs (facts 30, 40).
        if (row.name !== step.device) await this.#devices.renameDevice(`#${row.id}`, step.device);
        return;
      }
      case 'set-enabled':
        await this.#devices.setDeviceEnabled(ref(step.device, step.id), step.to);
        return;
      case 'set-parameter': {
        const update = await this.#parameters.updateParameters(ref(step.device, step.id), {
          [step.name]: step.to,
        });
        // D5: World Machine's rejection is an outcome, not an exception; for an apply it fails the step.
        const rejected = update.parameters.find((outcome) => outcome.outcome === 'rejected');
        if (rejected !== undefined) {
          throw new WorldMachineError(
            'WM_COMMAND_FAILED',
            `World Machine rejected ${step.name} = ${step.to} on '${step.device}'`,
            rejected.worldMachineMessage,
          );
        }
        return;
      }
      case 'connect':
        await this.#wires.connect(
          { device: ref(step.source.device, step.source.id), port: step.source.port },
          { device: ref(step.device, step.id), port: step.port },
        );
        return;
    }
  }

  /** Section 6 "Failure": restore unless World Machine timed out or crashed, and build the APPLY_FAILED error. */
  async #failed(
    error: WorldMachineError,
    index: number,
    total: number,
    step: PlanStep,
    snapshot: string,
    spec: GraphSpec,
    before: string,
    start: SessionSummary,
  ): Promise<WorldMachineError> {
    const text =
      error.worldMachineMessage === undefined
        ? undefined
        : worldMachineText(error.worldMachineMessage.split('\n'));
    const lost = error.code === 'TIMEOUT' || error.code === 'CRASHED' || !this.#sameSession(start);
    const rolledBack = lost ? false : await this.#restore(snapshot, spec, before);
    const details: ApplyFailureDetails = {
      failedStep: {
        index,
        step,
        code: error.code,
        message: error.message,
        ...(text === undefined ? {} : { worldMachineMessage: text }),
      },
      completedSteps: index,
      rolledBack,
      snapshot,
    };
    const outcome =
      error.code === 'CRASHED' || (lost && error.code !== 'TIMEOUT')
        ? `World Machine crashed, so nothing was restored, and snapshot '${snapshot}' is gone with it: a snapshot lives only in memory until a save (fact 59).`
        : error.code === 'TIMEOUT'
          ? `World Machine did not answer in time and was stopped, so nothing was restored, and snapshot '${snapshot}' is gone with it: a snapshot lives only in memory until a save (fact 59).`
          : rolledBack
            ? `The project was restored to snapshot '${snapshot}', which is kept for inspection; remove it with delete_snapshot.`
            : `The restore of snapshot '${snapshot}' could not be confirmed; restore it with restore_snapshot or in the World Machine window.`;
    return new WorldMachineError(
      'APPLY_FAILED',
      `Step ${index + 1} of ${total} (${step.op} '${step.device}') failed: ${error.message}. ${outcome}`,
      undefined,
      details,
    );
  }

  /** True while the session is the ready one the apply started in: same state and same project binding. */
  #sameSession(start: SessionSummary): boolean {
    const now = this.#session.status().session;
    if (now.state !== 'ready') return false;
    const a = now.binding;
    const b = start.binding;
    if (a === undefined || b === undefined) return a === b;
    return a.kind === b.kind && (a.kind === 'fresh' || (b.kind === 'opened' && a.path === b.path));
  }

  /** D14: true only when the restore succeeded and the read-back gives the plan's own fingerprint. */
  async #restore(snapshot: string, spec: GraphSpec, before: string): Promise<boolean> {
    try {
      await this.#snapshots.restore(snapshot);
      return planId(spec, await readGraphState(spec, this.#graph, this.#session)) === before;
    } catch (error) {
      if (error instanceof WorldMachineError) return false;
      throw error;
    }
  }

  /** Reads back every device a step touched that still exists, and diffs it with the state from before. */
  async #diff(
    steps: readonly PlanStep[],
    state: GraphState,
    added: ReadonlyMap<string, number>,
  ): Promise<DiffEntry[]> {
    const ids = new Set<number>();
    for (const step of steps) {
      if (step.op === 'remove') continue;
      const id =
        step.op === 'add' ? added.get(foldCase(step.device)) : (step.id ?? added.get(foldCase(step.device)));
      if (id !== undefined) ids.add(id);
    }
    const after: DeviceDetail[] = [];
    for (const id of ids) after.push(await this.#graph.getDevice(`#${id}`));
    return graphDiff(steps, { before: state.details, after, addedIds: added });
  }

  /** D16: false when the delete failed; the apply succeeded, so the result then names the snapshot still there. */
  async #removeSnapshot(snapshot: string): Promise<boolean> {
    try {
      await this.#snapshots.remove(snapshot);
      return true;
    } catch (error) {
      if (error instanceof WorldMachineError) return false;
      throw error;
    }
  }
}
