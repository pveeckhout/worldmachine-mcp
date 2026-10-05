import type { InputPort, OutputPort, PortLink } from '../../../../domain/device.js';
import { unexpectedOutput } from './unexpected.js';

const HEADER = /^Connections for '.*':$/;
const LINK = /^'(.*)'\s+\[(\d+)\]$/;
// Port names are space-padded to a column in some rows, so split on the arrow, not on whitespace.
const INPUT = /^\s+\[(\d+)\]\s+(.*?)\s+<-\s+(.*?)\s*$/;
const OUTPUT = /^\s+\[(\d+)\]\s+(.*?)\s+->\s+(.*?)\s*$/;
const CONTINUATION = /^\s+->\s+(.*?)\s*$/;

function link(text: string, output: readonly string[]): PortLink | undefined {
  if (text === '(none)') return undefined;
  const match = LINK.exec(text);
  if (!match || match[1] === undefined) throw unexpectedOutput('wire list', output);
  return { device: match[1], port: Number(match[2]) };
}

export function parseWireList(output: readonly string[]): { inputs: InputPort[]; outputs: OutputPort[] } {
  const [header, ...rows] = output;
  if (header === undefined || !HEADER.test(header.trim())) throw unexpectedOutput('wire list', output);
  const inputs: InputPort[] = [];
  const outputs: { port: number; name: string; targets: PortLink[] }[] = [];
  let section: 'inputs' | 'outputs' | undefined;
  const seen = new Set<'inputs' | 'outputs'>();
  for (const row of rows) {
    const trimmed = row.trim();
    if (trimmed === '') continue;
    if (trimmed === 'Inputs:') {
      section = 'inputs';
      seen.add(section);
      continue;
    }
    if (trimmed === 'Outputs:') {
      section = 'outputs';
      seen.add(section);
      continue;
    }
    if (section === 'inputs') {
      const match = INPUT.exec(row);
      if (!match?.[2] || match[3] === undefined) throw unexpectedOutput('wire list', output);
      const source = link(match[3], output);
      inputs.push(
        source
          ? { port: Number(match[1]), name: match[2], source }
          : { port: Number(match[1]), name: match[2] },
      );
      continue;
    }
    if (section === 'outputs') {
      const port = OUTPUT.exec(row);
      if (port?.[2] && port[3] !== undefined) {
        const target = link(port[3], output);
        outputs.push({ port: Number(port[1]), name: port[2], targets: target ? [target] : [] });
        continue;
      }
      const continuation = CONTINUATION.exec(row);
      const last = outputs.at(-1);
      if (continuation?.[1] !== undefined && last) {
        const target = link(continuation[1], output);
        if (target) last.targets.push(target);
        continue;
      }
    }
    throw unexpectedOutput('wire list', output);
  }
  // Every captured shape prints both headers, even when a section is empty (spec fact 21); a missing one is not "no ports".
  if (!seen.has('inputs') || !seen.has('outputs')) throw unexpectedOutput('wire list', output);
  return { inputs, outputs };
}
