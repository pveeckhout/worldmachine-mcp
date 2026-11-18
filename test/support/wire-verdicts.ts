import type { RecordPortTypeCorrectionPort } from '../../src/application/port/out/record-port-type-correction-port.js';
import { WireVerdicts } from '../../src/application/service/wire-verdicts.js';
import type { PortTypeCorrection } from '../../src/domain/catalog.js';
import { sampleDerivedPortTypes } from './port-types.js';

/** A recorder that keeps what it is given in memory. */
export const memoryRecorder = (): RecordPortTypeCorrectionPort & {
  readonly recorded: PortTypeCorrection[];
} => {
  const recorded: PortTypeCorrection[] = [];
  return { recorded, record: (correction) => void recorded.push(correction) };
};

/** Verdicts over a recorder nobody reads, for tests that do not care. */
export const NO_VERDICTS = new WireVerdicts(sampleDerivedPortTypes, memoryRecorder());
