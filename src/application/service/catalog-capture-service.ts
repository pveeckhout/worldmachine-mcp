import { join } from 'node:path';
import {
  type CatalogKind,
  closestStrictBase,
  type DeviceType,
  type PortTypeCatalog,
} from '../../domain/catalog.js';
import {
  busyMessage,
  type CaptureOutcome,
  type CapturePhase,
  type CaptureView,
  CatalogCapture,
  captureRefusal,
} from '../../domain/catalog-capture.js';
import { WorldMachineError } from '../../domain/errors.js';
import type {
  CancelCatalogCaptureCommand,
  CancelCatalogCapturePort,
} from '../port/in/command/cancel-catalog-capture-command.js';
import type {
  StartCatalogCaptureCommand,
  StartCatalogCapturePort,
} from '../port/in/command/start-catalog-capture-command.js';
import type {
  GetCatalogCaptureStatusPort,
  GetCatalogCaptureStatusQuery,
} from '../port/in/query/get-catalog-capture-status-query.js';
import type { DiscardCaptureTranscriptPort } from '../port/out/discard-capture-transcript-port.js';
import type { CaptureRecord, InstallCatalogPort } from '../port/out/install-catalog-port.js';
import type { LeaseSessionPort, SessionLease } from '../port/out/lease-session-port.js';
import type { ListCatalogsPort } from '../port/out/list-catalogs-port.js';
import type { RegisterCatalogsPort } from '../port/out/register-catalogs-port.js';
import type {
  CaptureResult,
  CaptureRun,
  RunCatalogCapturePort,
} from '../port/out/run-catalog-capture-port.js';
import type { WorldMachineSessionPort } from '../port/out/world-machine-session-port.js';

export type CatalogCapturePorts = {
  readonly session: WorldMachineSessionPort;
  readonly leases: LeaseSessionPort;
  readonly capturer: RunCatalogCapturePort;
  readonly transcripts: DiscardCaptureTranscriptPort;
  readonly catalogs: ListCatalogsPort;
  readonly installer: InstallCatalogPort;
  readonly registry: RegisterCatalogsPort;
};

export type CatalogCaptureSettings = {
  /** `<catalogDir>/<build>/` holds the local catalogs and the capture's working folder. */
  readonly catalogDir: string;
  readonly serverVersion: string;
  /** The fixed estimate per phase, for the percent and the minutes left. */
  readonly phaseMinutes: Readonly<Record<CapturePhase, number>>;
  readonly now?: () => Date;
};

export type CaptureEventSink = (name: string, fields: Record<string, unknown>) => void;

/** The running capture: its domain object, the lease it holds, and the job that ends it. */
type Running = {
  readonly capture: CatalogCapture;
  readonly controller: AbortController;
  job: Promise<void>;
};

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * One catalog capture at a time, run in the background on a session lease. The job that ends a run never rejects:
 * a failed run, a failed install, and a failing event sink all end in an outcome and a released lease.
 */
export class CatalogCaptureService
  implements StartCatalogCapturePort, CancelCatalogCapturePort, GetCatalogCaptureStatusPort
{
  readonly #ports: CatalogCapturePorts;
  readonly #settings: CatalogCaptureSettings;
  readonly #onEvent: CaptureEventSink;
  readonly #now: () => Date;
  #running: Running | undefined;
  #last: CatalogCapture | undefined;

  constructor(ports: CatalogCapturePorts, settings: CatalogCaptureSettings, onEvent: CaptureEventSink) {
    this.#ports = ports;
    this.#settings = settings;
    this.#onEvent = onEvent;
    this.#now = settings.now ?? (() => new Date());
  }

  async start(command: StartCatalogCaptureCommand): Promise<CaptureView> {
    if (this.#running !== undefined) {
      throw new WorldMachineError('CAPTURING', busyMessage(this.#running.capture.view(this.#now())));
    }
    const { session, leases, catalogs } = this.#ports;
    await session.ensureRunning();
    const status = session.status();
    const build = status.systemInfo?.build;
    if (build === undefined) {
      throw new WorldMachineError('REFUSED', 'World Machine did not report its build; a capture needs it');
    }
    const portTypes = catalogs.portTypeCatalogs();
    const refusal = captureRefusal(
      command.mode,
      portTypes.map((entry) => entry.source),
      build,
    );
    if (refusal !== undefined) throw new WorldMachineError('REFUSED', refusal);
    if (status.session.dirty === true && !command.discardOpenProject) {
      throw new WorldMachineError(
        'REFUSED',
        'the open project has unsaved changes, and a capture closes the open project first; save it, or start again with discardOpenProject: true',
      );
    }
    const base = closestStrictBase(portTypes, build);
    if (command.mode === 'short' && base === undefined) {
      throw new WorldMachineError(
        'REFUSED',
        `a short capture checks its sample against a strict catalog of another build, and there is none; use mode full`,
      );
    }
    const others = portTypes.filter((entry) => entry !== base).map((entry) => entry.catalog);
    const addWords = [base?.catalog, ...others].flatMap((catalog) =>
      catalog === undefined ? [] : Object.values(catalog.types).flatMap((type) => type.added),
    );
    const typeNames = [
      ...portTypes.flatMap((entry) => Object.keys(entry.catalog.types)),
      ...catalogs.enumCatalogs().flatMap((catalog) => Object.keys(catalog.types)),
    ];
    const run: CaptureRun = {
      build,
      mode: command.mode,
      ...(base === undefined ? {} : { base: base.catalog }),
      known: { addWords: [...new Set(addWords)], typeNames: [...new Set(typeNames)] },
      workDir: join(this.#settings.catalogDir, String(build), `.capture-${command.mode}`),
    };

    const capture = new CatalogCapture(build, command.mode, this.#now(), this.#settings.phaseMinutes);
    const lease = leases.lease(() => busyMessage(capture.view(this.#now())));
    const running: Running = { capture, controller: new AbortController(), job: Promise.resolve() };
    this.#running = running;
    this.#last = capture;
    this.#emit('catalog_capture_started', { build, mode: command.mode });
    running.job = Promise.resolve()
      .then(() => this.#job(run, lease, running))
      .catch(() => {
        // #job never rejects; this keeps a mistake in it from becoming an unhandled rejection.
      });
    return capture.view(this.#now());
  }

  async cancel(_command: CancelCatalogCaptureCommand): Promise<CaptureView | null> {
    const running = this.#running;
    if (running === undefined) return null;
    running.controller.abort();
    await running.job;
    return running.capture.view(this.#now());
  }

  async status(_query: GetCatalogCaptureStatusQuery): Promise<CaptureView | null> {
    return this.#last?.view(this.#now()) ?? null;
  }

  async #job(run: CaptureRun, lease: SessionLease, running: Running): Promise<void> {
    const { capture, controller } = running;
    let outcome: CaptureOutcome;
    try {
      const result = await this.#ports.capturer.run(
        run,
        lease,
        (progress) => capture.progress(progress, this.#now()),
        controller.signal,
      );
      outcome = this.#install(run, result, capture);
    } catch (error) {
      outcome = controller.signal.aborted
        ? { kind: 'cancelled' }
        : {
            kind: 'failed',
            reason: `${reasonOf(error)} (the next capture of build ${run.build} in mode ${run.mode} resumes from ${run.workDir}; delete that folder to start over)`,
          };
    } finally {
      try {
        lease.release();
      } catch {
        // A lease that cannot be released any more has nothing left to give back.
      }
    }
    capture.finish(outcome);
    if (this.#running === running) this.#running = undefined;
    this.#emit('catalog_capture_finished', {
      build: run.build,
      mode: run.mode,
      outcome: outcome.kind,
      ...(outcome.kind === 'failed' ? { reason: outcome.reason } : {}),
      ...(outcome.kind === 'sample-disagreed' ? { reason: outcome.disagreement } : {}),
    });
  }

  /** Validates and installs per the outcome rules, registers what it installed, and removes the working folder. */
  #install(run: CaptureRun, result: CaptureResult, capture: CatalogCapture): CaptureOutcome {
    const check = result.portTypes;
    const sample = 'omittedTypes' in check ? check : undefined;
    const disagreement = check.agreed ? undefined : check.disagreement;
    const portTypes: PortTypeCatalog | undefined = check.agreed ? check.catalog : undefined;
    const kind: CatalogKind = run.mode === 'full' ? 'strict' : 'sample-derived';
    const { discovery } = result;
    const deviceTypes: DeviceType[] = [
      ...discovery.types,
      ...discovery.notReached.map((addName) => ({ addName, aliases: [], reached: false })),
    ];
    const record: CaptureRecord = {
      mode: run.mode,
      date: this.#now().toISOString(),
      serverVersion: this.#settings.serverVersion,
      ...(run.mode === 'short' && run.base !== undefined ? { baseBuild: run.base.build } : {}),
      ...(run.mode === 'short' ? { sampleCheck: disagreement ?? 'agreed' } : {}),
      notCaptured: discovery.notReached,
      untypedTypes: sample?.untypedTypes ?? [],
      discoveryIncomplete: true,
      ambiguousTagsNamedTypes: discovery.listedByConsole,
      deviceTypes,
    };

    capture.progress({ phase: 'validate', done: 0, total: 1 }, this.#now());
    // The installer checks the catalogs against the World Machine running now, not the one the run started on.
    const runningBuild = this.#ports.session.status().systemInfo?.build;
    if (runningBuild === undefined) throw new Error('World Machine did not report its build at install time');
    this.#ports.installer.install(
      {
        build: run.build,
        enumOptions: result.enumOptions,
        ...(portTypes === undefined ? {} : { portTypes }),
        record,
      },
      runningBuild,
    );
    capture.progress({ phase: 'install', done: 1, total: 1 }, this.#now());
    this.#ports.registry.add(run.build, {
      enumOptions: result.enumOptions,
      ...(portTypes === undefined
        ? {}
        : { portTypes: { catalog: portTypes, source: { build: run.build, kind, origin: 'local' } } }),
    });
    try {
      this.#ports.transcripts.discard(run.workDir);
    } catch {
      // The catalogs are installed; a leftover working folder is set aside by the next run of this build.
    }

    const notes = [
      ...(sample !== undefined && sample.omittedTypes.length > 0
        ? [`types not in the sample: ${sample.omittedTypes.join(', ')}`]
        : []),
      ...(sample !== undefined && sample.untypedTypes.length > 0
        ? [`types without port types: ${sample.untypedTypes.join(', ')}`]
        : []),
      ...(result.refusedWords.length > 0
        ? [`add words World Machine refused: ${result.refusedWords.join(', ')}`]
        : []),
      ...(result.enumGaps.length > 0
        ? [`enum rows without a range error, their types left out: ${result.enumGaps.join(', ')}`]
        : []),
      ...result.timedOutPairs.map(
        (pair) =>
          `pair ${pair} timed out 3 times; it is recorded as a hole (crashed), so its verdict is unknown`,
      ),
      ...(discovery.notReached.length > 0
        ? [`known types not added: ${discovery.notReached.join(', ')}`]
        : []),
      `discovery is incomplete for this build: World Machine has no command that lists device types; ${
        discovery.listedByConsole
          ? 'some types that no catalog knows were reached through ambiguous tags, not necessarily all'
          : 'this build does not name the types an ambiguous tag matches, so only the known types were tried'
      }`,
      ...(disagreement === undefined
        ? []
        : [
            'the sample disagreed with the base catalog, so no port types are used for this build; capture_catalog mode full captures them',
          ]),
    ];
    if (disagreement !== undefined) {
      return { kind: 'sample-disagreed', disagreement, installed: ['enum-options'], notes };
    }
    return { kind: 'installed', installed: ['enum-options', 'port-types'], notes };
  }

  #emit(name: string, fields: Record<string, unknown>): void {
    try {
      this.#onEvent(name, fields);
    } catch {
      // A failing event sink never changes a capture.
    }
  }
}
