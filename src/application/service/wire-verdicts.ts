import {
  judgeVerdict,
  type PortRef,
  type VerdictReport,
  type VerdictSource,
  type WireTyping,
  type WireVerdict,
} from '../../domain/catalog.js';
import { WorldMachineError } from '../../domain/errors.js';
import type { PortTypeCatalogPort } from '../port/out/port-type-catalog-port.js';
import type { RecordPortTypeCorrectionPort } from '../port/out/record-port-type-correction-port.js';

/** What a reported verdict was about, for whoever logs it. */
export type ReportContext = {
  readonly build: number;
  readonly source: VerdictSource;
  readonly output: PortRef | undefined;
  readonly input: PortRef | undefined;
};

/** Judges World Machine's verdict on a wire against the catalog's prediction, and records a contradiction. */
export class WireVerdicts {
  readonly #portTypes: PortTypeCatalogPort;
  readonly #corrections: RecordPortTypeCorrectionPort;
  readonly #now: () => Date;
  readonly #onReport: ((report: VerdictReport, context: ReportContext) => void) | undefined;

  constructor(
    portTypes: PortTypeCatalogPort,
    corrections: RecordPortTypeCorrectionPort,
    now: () => Date = () => new Date(),
    onReport?: (report: VerdictReport, context: ReportContext) => void,
  ) {
    this.#portTypes = portTypes;
    this.#corrections = corrections;
    this.#now = now;
    this.#onReport = onReport;
  }

  /** Judges and records; a record that throws turns the outcome into 'reported' with the error message as reason. */
  observe(
    typing: WireTyping | undefined,
    verdict: WireVerdict,
    source: VerdictSource,
  ): VerdictReport | undefined {
    if (typing === undefined) return undefined;
    const catalog = this.#portTypes.catalogInUse();
    if (catalog === undefined) return undefined;
    const report = judgeVerdict(catalog.kind, typing, verdict);
    const { output, input } = typing;
    const context = { build: catalog.build, source, output, input };
    if (report === undefined) return report;
    if (report.outcome !== 'recorded') {
      this.#onReport?.(report, context);
      return report;
    }
    // A recorded outcome means both ends are typed and neither is adaptive.
    if (output === undefined || input === undefined) return report;
    try {
      this.#corrections.record({
        build: catalog.build,
        output,
        input,
        verdict,
        source,
        at: this.#now().toISOString(),
      });
      return report;
    } catch (error) {
      const refused: VerdictReport = {
        ...report,
        outcome: 'reported',
        reason: error instanceof Error ? error.message : String(error),
      };
      this.#onReport?.(refused, context);
      return refused;
    }
  }

  /** For a caught error: the refused verdict when it carries details.typing, otherwise undefined. */
  observeRefusal(error: unknown, source: VerdictSource): VerdictReport | undefined {
    if (!(error instanceof WorldMachineError)) return undefined;
    const typing = error.details?.typing;
    if (typing === undefined) return undefined;
    return this.observe(typing as WireTyping, 'refused', source);
  }
}
