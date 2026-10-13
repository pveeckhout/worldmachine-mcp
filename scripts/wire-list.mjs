// Reads the `wire list` answer of World Machine for the port-type tooling: the catalog parser
// (scripts/port-type-catalog.mjs) and the capture probe (scripts/port-type-probe.mjs) share it (port-types plan
// decision D11). Plain JavaScript because a Node script cannot import TypeScript from src/; wire-list.d.mts types it.

// src/adapter/out/worldmachine/parsers/device-list.ts ROW: an id, the name, and an optional parenthesised kind.
export const DEVICE_ROW = /^\s*#(\d+)\s+(.*?)(?:\s{2,}\(([^()]+)\))?\s*$/;
// src/adapter/out/worldmachine/parsers/wire-list.ts: port names are space-padded, so a row splits on its arrow.
export const HEADER = /^Connections for '.*':$/;
export const INPUT = /^\s+\[(\d+)\]\s+(.*?)\s+<-\s+(.*?)\s*$/;
export const OUTPUT = /^\s+\[(\d+)\]\s+(.*?)\s+->\s+(.*?)\s*$/;
export const CONTINUATION = /^\s+->\s+(.*?)\s*$/;

/** The ports of a `wire list`; every input must still be free (plan decision D11). */
export function readWireList(command, lines) {
  const [header, ...rows] = lines;
  if (!HEADER.test(header?.trim() ?? '')) throw new Error(`${command}: unreadable header`);
  const inputs = [];
  const outputs = [];
  const seen = new Set();
  let section;
  for (const row of rows) {
    const trimmed = row.trim();
    if (trimmed === 'Inputs:' || trimmed === 'Outputs:') {
      section = trimmed;
      seen.add(section);
      continue;
    }
    const input = section === 'Inputs:' ? INPUT.exec(row) : null;
    if (input !== null) {
      if (input[3] !== '(none)') throw new Error(`${command}: input ${input[1]} is wired before probing`);
      inputs.push({ port: Number(input[1]), name: input[2] });
      continue;
    }
    const output = section === 'Outputs:' ? OUTPUT.exec(row) : null;
    if (output !== null) {
      outputs.push({ port: Number(output[1]), name: output[2] });
      continue;
    }
    if (section === 'Outputs:' && CONTINUATION.test(row)) continue;
    throw new Error(`${command}: unreadable row '${row}'`);
  }
  // Every captured shape prints both headers, even for an empty section (v1 fact 21).
  if (seen.size !== 2) throw new Error(`${command}: no Inputs: or Outputs: line`);
  return { inputs, outputs };
}
