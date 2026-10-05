import type { DeviceSummary } from '../../../../domain/device.js';
import { unexpectedOutput } from './unexpected.js';

const HEADER = /^Devices \((\d+) total\):$/;
const EMPTY = 'No devices in the current project.';
// Name, then optionally two or more spaces and a parenthesised kind such as "(Macro)".
const ROW = /^\s*#(\d+)\s+(.*?)(?:\s{2,}\(([^()]+)\))?\s*$/;
// State markers World Machine appends after the name and kind (spec fact 24), e.g. "[disabled]".
const MARKER = /\s+\[(disabled|bypassed)\]$/;

/** Peels trailing `[disabled]` / `[bypassed]` tokens off a row; other bracketed text stays in the name, a repeated marker fails the parse. */
function splitMarkers(
  row: string,
): { text: string; enabled: boolean; bypassed: boolean | undefined } | undefined {
  let text = row.trimEnd();
  let enabled = true;
  let bypassed: boolean | undefined;
  let seenDisabled = false;
  let seenBypassed = false;
  for (let match = MARKER.exec(text); match; match = MARKER.exec(text)) {
    if (match[1] === 'disabled' && !seenDisabled) {
      seenDisabled = true;
      enabled = false;
    } else if (match[1] === 'bypassed' && !seenBypassed) {
      seenBypassed = true;
      bypassed = true;
    } else return undefined;
    text = text.slice(0, match.index);
  }
  // A `[disabled]` row hides bypass (spec fact 29), so it stays unknown unless the row says `[bypassed]`.
  return { text, enabled, bypassed: bypassed ?? (enabled ? false : undefined) };
}

/** `filtered`: the header keeps the unfiltered total when `device list` gets a filter (spec fact 16). */
export function parseDeviceList(output: readonly string[], filtered = false): DeviceSummary[] {
  if (output.length === 1 && output[0]?.trim() === EMPTY) return [];
  const [header, ...rows] = output;
  const count = header === undefined ? null : HEADER.exec(header.trim());
  if (!count) throw unexpectedOutput('device list', output);
  const devices = rows
    .filter((row) => row.trim() !== '')
    .map((row): DeviceSummary => {
      const split = splitMarkers(row);
      if (!split) throw unexpectedOutput('device list', output);
      const { enabled, bypassed } = split;
      const match = ROW.exec(split.text);
      const name = match?.[2];
      if (!match || !name) throw unexpectedOutput('device list', output);
      const id = Number(match[1]);
      return {
        id,
        name,
        ...(match[3] === undefined ? {} : { kind: match[3] }),
        enabled,
        ...(bypassed === undefined ? {} : { bypassed }),
      };
    });
  const total = Number(count[1]);
  if (filtered ? devices.length > total : devices.length !== total)
    throw unexpectedOutput('device list', output);
  return devices;
}
