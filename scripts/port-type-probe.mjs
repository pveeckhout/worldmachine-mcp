// The pure part of the `port-types` capture (port-types design section 3, plan decisions D10, D11, and D20; Codex round
// 1 rulings B3 and S2): the commands sent for one pair, and the verdict line text read from their answers. One module
// for scripts/capture-fixtures.mjs and its tests; plain JavaScript as scripts/enum-catalog.mjs, typed by
// port-type-probe.d.mts.

import { LOG_LINE } from './enum-catalog.mjs';
import { CONTINUATION, HEADER, INPUT, OUTPUT } from './wire-list.mjs';

/**
 * Port-types plan decision D22 (Codex round 1 ruling B1 addendum): every word `device add` accepted in phase A of a
 * `v3-rename-types` capture (raw/v3-rename-types.txt l.1-620: 205 words; l.621 opens `(phase A)`), in capture order:
 * a `device add <word>` section whose answer is an `Added '<name>'` line. Later sections are phase B and are ignored.
 */
export function acceptedAddWords(transcript) {
  const words = [];
  let word;
  for (const line of transcript.split('\n')) {
    if (line === '>>> (phase A)') break;
    if (line.startsWith('>>> '))
      word = line.startsWith('>>> device add ') ? line.slice('>>> device add '.length) : undefined;
    else if (word !== undefined && /^Added '.*'$/.test(line.trimEnd()) && !words.includes(word))
      words.push(word);
  }
  return words;
}

// raw/reach-scaling-inputs.txt l.604-605, raw/create-water-sea.txt l.194-195.
export const INCOMPATIBLE = 'Error: Error: Failed to create connection (incompatible types?)';

/** A section's lines without blank and log lines, trailing whitespace dropped; none for a missing section. */
const answerOf = (section) =>
  (section?.lines ?? [])
    .filter((line) => line.trim() !== '' && !LOG_LINE.test(line))
    .map((line) => line.trimEnd());

/**
 * A `wire list` answer read completely (Codex round 1 ruling B3): its header, both section lines once, and only port
 * rows; undefined for a missing section, an `Error:` line, or any other line.
 */
export function readProbeWireList(section) {
  const [header, ...rows] = answerOf(section);
  if (header === undefined || !HEADER.test(header.trim())) return undefined;
  const inputs = [];
  const outputs = [];
  const seen = new Set();
  let part;
  for (const row of rows) {
    const trimmed = row.trim();
    if (trimmed === 'Inputs:' || trimmed === 'Outputs:') {
      if (seen.has(trimmed)) return undefined;
      part = trimmed;
      seen.add(trimmed);
      continue;
    }
    const input = part === 'Inputs:' ? INPUT.exec(row) : null;
    if (input !== null) {
      inputs.push({ port: Number(input[1]), source: input[3] });
      continue;
    }
    const output = part === 'Outputs:' ? OUTPUT.exec(row) : null;
    if (output !== null) {
      outputs.push({ port: Number(output[1]) });
      continue;
    }
    if (part === 'Outputs:' && CONTINUATION.test(row)) continue;
    return undefined;
  }
  return seen.size === 2 ? { inputs, outputs } : undefined;
}

/** Plan decision D20: the inputs a pair's disconnects cover; every input of the destination unless lean. */
const sweptPorts = (target, lean) => (lean ? [target.port] : target.inputs);

/**
 * Plan decisions D10 and D20: the commands for one pair. Checked: `wire connect`, the destination's `wire list`, and
 * `wire disconnect` of the source port from every input of the destination (fact 26: confirmed whether or not the wire
 * existed). Lean: `wire connect` and `wire disconnect` of the same wire.
 */
export function probeCommands(source, target, lean) {
  const from = `#${source.id}.${source.port}`;
  return [
    `wire connect ${from} #${target.id}.${target.port}`,
    ...(lean ? [] : [`wire list #${target.id}`]),
    ...sweptPorts(target, lean).map((input) => `wire disconnect ${from} #${target.id}.${input}`),
  ];
}

/**
 * Plan decision D11: one pair's verdict from the answers to probeCommands, in order. `connected` for the exact
 * confirmation and `refused` for the exact refusal, each with every disconnect confirmed. Checked mode also needs the
 * destination's `wire list` to read completely and list every input (Codex round 1 ruling B3), with the wire on that
 * input only (connected) or no wire from the source (refused); a refusal that shows the source on other inputs is
 * `refused stray <ports>`, which the parser rejects (ruling B2). Anything else is `error: ...` with every answer.
 */
export function probeVerdict(source, target, answers, lean) {
  const ends = (port) => `'#${source.id}' [${source.port}] -> '#${target.id}' [${port}]`;
  const swept = sweptPorts(target, lean);
  const connect = answers[0];
  const shown = lean ? undefined : answers[1];
  const sweep = answers.slice(lean ? 1 : 2);
  const said = answerOf(connect);
  const sweptOk =
    sweep.length === swept.length &&
    sweep.every((section, index) => {
      const lines = answerOf(section);
      return lines.length === 1 && lines[0] === `Disconnected ${ends(swept[index])}`;
    });
  const listed = lean ? undefined : readProbeWireList(shown);
  const listedOk =
    lean ||
    (listed !== undefined &&
      target.inputs.every((port) => listed.inputs.some((input) => input.port === port)));
  const fromSource = `'${source.name}' [${source.port}]`;
  const wired = (listed?.inputs ?? []).filter((input) => input.source !== '(none)');
  if (sweptOk && listedOk && said.length === 1) {
    const onlyThere = wired.length === 1 && wired[0].port === target.port && wired[0].source === fromSource;
    if (said[0] === `Connected ${ends(target.port)}` && (lean || onlyThere)) return 'connected';
    if (
      said[0] === INCOMPATIBLE &&
      wired.every((input) => input.source === fromSource && input.port !== target.port)
    ) {
      return wired.length === 0
        ? 'refused'
        : `refused stray ${wired.map((input) => `#${target.id}.${input.port}`).join(' ')}`;
    }
  }
  const text = (section) => (section === undefined ? 'missing' : answerOf(section).join(' | '));
  const list = lean ? '' : ` wire list [${text(shown)}]`;
  return `error: connect [${text(connect)}]${list} disconnect [${sweep.map(text).join(' / ')}]`;
}

/**
 * Port-types design section 3, crashes and resumes: the verdict of the pair whose command was in flight when World
 * Machine exited. The catalog reads it as a hole (design section 4).
 */
export const CRASHED = 'crashed';

/**
 * Port-types design section 3, crashes and resumes: the index of the target in flight when a batch stopped, given the
 * per-target command lists of the batch (`sent`, as probeOutputs builds them) and how many commands answered
 * (`completed` end echoes); undefined when every command answered.
 */
export function crashedTarget(sent, completed) {
  let end = 0;
  for (const [index, commands] of sent.entries()) {
    end += commands.length;
    if (completed < end) return index;
  }
  return undefined;
}
