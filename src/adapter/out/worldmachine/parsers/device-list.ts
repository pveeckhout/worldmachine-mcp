import type { DeviceSummary } from '../../../../domain/device.js';
import { unexpectedOutput } from './unexpected.js';

const HEADER = /^Devices \((\d+) total\):$/;
const EMPTY = 'No devices in the current project.';
// Name, then optionally two or more spaces and a parenthesised kind such as "(Macro)".
const ROW = /^\s*#(\d+)\s+(.*?)(?:\s{2,}\(([^()]+)\))?\s*$/;

/** `filtered`: the header keeps the unfiltered total when `device list` gets a filter (spec fact 16). */
export function parseDeviceList(output: readonly string[], filtered = false): DeviceSummary[] {
  if (output.length === 1 && output[0]?.trim() === EMPTY) return [];
  const [header, ...rows] = output;
  const count = header === undefined ? null : HEADER.exec(header.trim());
  if (!count) throw unexpectedOutput('device list', output);
  const devices = rows
    .filter((row) => row.trim() !== '')
    .map((row): DeviceSummary => {
      const match = ROW.exec(row);
      const name = match?.[2];
      if (!match || !name) throw unexpectedOutput('device list', output);
      const id = Number(match[1]);
      return match[3] === undefined ? { id, name } : { id, name, kind: match[3] };
    });
  const total = Number(count[1]);
  if (filtered ? devices.length > total : devices.length !== total)
    throw unexpectedOutput('device list', output);
  return devices;
}
