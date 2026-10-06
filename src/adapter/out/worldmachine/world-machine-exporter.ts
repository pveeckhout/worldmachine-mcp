import type { ExportPort } from '../../../application/port/out/export-port.js';
import { WorldMachineError } from '../../../domain/errors.js';
import type { ExportTarget } from '../../../domain/output-template.js';
import { buildCommand } from './command-builder.js';
import { listAllDevices } from './device-lookup.js';
import { matchesListedName } from './device-reference.js';
import { parseExportAll } from './parsers/export-all.js';
import { parseExportList } from './parsers/export-list.js';
import { type RawResponse, throwIfFailed } from './raw-response.js';
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

  async exportingAlways(devices: readonly string[]): Promise<string[]> {
    this.#session.assertAcceptingCalls();
    const listed = await listAllDevices(this.#session);
    // `export list` prints full names; `device list` cuts them at 23 characters (fact 33) and names match regardless
    // of case (fact 31). Several devices may share a name (fact 30): only exactly one match is read.
    const resolved = devices.map((device) => {
      const matches = listed.filter((candidate) =>
        matchesListedName(device.toLowerCase(), candidate.name.toLowerCase()),
      );
      return { device, id: matches.length === 1 ? matches[0]?.id : undefined };
    });
    const read = resolved.flatMap((item) => (item.id === undefined ? [] : [item.id]));
    const responses =
      read.length === 0
        ? []
        : await this.#session.execute(
            read.map((id) => buildCommand(['param', 'get', `#${id}.exportAlways`])),
          );
    const off = new Set(read.filter((id, index) => confirmsOff(id, responses[index])));
    return resolved.flatMap((item) => (item.id !== undefined && off.has(item.id) ? [] : [item.device]));
  }
}

/**
 * Ruling P-FR-3: off only on exactly `#<id>.exportAlways = false`, or on exactly the not-found error a Material or
 * Bitmap Output gives (raw/v2-build-isolate.txt l.17-42); every other answer counts as on.
 */
function confirmsOff(id: number, response: RawResponse | undefined): boolean {
  if (response === undefined) return false;
  const { output, errors } = response;
  if (errors.length === 0) return output.length === 1 && output[0] === `#${id}.exportAlways = false`;
  return (
    output.length === 0 &&
    errors.length === 1 &&
    errors[0] === `Error: Error: Parameter 'exportAlways' not found on device '#${id}'.`
  );
}
