import type { ExportPort } from '../../../application/port/out/export-port.js';
import { WorldMachineError } from '../../../domain/errors.js';
import type { ExportTarget } from '../../../domain/output-template.js';
import { parseExportAll } from './parsers/export-all.js';
import { parseExportList } from './parsers/export-list.js';
import { throwIfFailed } from './raw-response.js';
import type { WorldMachineSession } from './world-machine-session.js';

// Fact 50, raw/v2-build-long.txt l.103-104.
const NOT_BUILT = 'Some output devices are not built';

export class WorldMachineExporter implements ExportPort {
  readonly #session: WorldMachineSession;

  constructor(session: WorldMachineSession) {
    this.#session = session;
  }

  async targets(): Promise<ExportTarget[]> {
    this.#session.assertAcceptingCalls();
    const response = await this.#session.executeOne('export list');
    throwIfFailed(response);
    return parseExportList(response.output);
  }

  async exportAll(): Promise<string[]> {
    this.#session.assertAcceptingCalls();
    const response = await this.#session.executeOne('export all');
    if (response.errors.some((line) => line.includes(NOT_BUILT))) {
      throw new WorldMachineError(
        'WM_COMMAND_FAILED',
        'The outputs are not built; run build_project with mode full first',
        response.errors.join('\n'),
      );
    }
    throwIfFailed(response);
    return parseExportAll(response.output);
  }
}
