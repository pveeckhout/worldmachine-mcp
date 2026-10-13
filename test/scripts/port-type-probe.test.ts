import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  acceptedAddWords,
  INCOMPATIBLE,
  type ProbeSection,
  probeCommands,
  probeVerdict,
  readProbeWireList,
} from '../../scripts/port-type-probe.mjs';

// Codex round 1 rulings B3 and S2. Small ids for raw/create-water-sea.txt l.194-195: a Gradient's output 1 into a
// Create Water's three inputs.
const GRADIENT = { id: 1, name: 'Gradient', port: 1 };
const EXISTING_WATER = { id: 2, port: 2, inputs: [1, 2, 3] };
const TERRAIN = { id: 2, port: 1, inputs: [1, 2, 3] };
const section = (...lines: string[]): ProbeSection => ({ lines });
/** raw/create-water.txt l.122-133 as `wire list #2`, its inputs as given (`(none)` when absent). */
const wireList = (sources: Readonly<Record<number, string>> = {}) =>
  section(
    "Connections for '#2':",
    '  Inputs:',
    `    [1] Terrain      <- ${sources[1] ?? '(none)'}`,
    `    [2] Existing Water <- ${sources[2] ?? '(none)'}`,
    `    [3] Precipitation Map <- ${sources[3] ?? '(none)'}`,
    '  Outputs:',
    '    [1] Terrain      -> (none)',
    '    [2] Water System -> (none)',
    '    [3] Tributary Mask -> (none)',
    '    [4] Lake Mask    -> (none)',
    '',
  );
// raw/p2b-graph-edits.txt l.117-118 and fact 26: a disconnect is confirmed whether or not the wire existed.
const disconnected = (input: number) => section(`Disconnected '#1' [1] -> '#2' [${input}]`);
const SWEEP = [disconnected(1), disconnected(2), disconnected(3)];

describe('acceptedAddWords (port-types plan decision D22, Codex round 1 ruling B1 addendum)', () => {
  const words = acceptedAddWords(
    readFileSync(new URL('../fixtures/wm-4067/raw/v3-rename-types.txt', import.meta.url), 'utf8'),
  );

  it('lists the 205 words phase A of raw/v3-rename-types.txt accepted (l.621-622), once each', () => {
    expect(words).toHaveLength(205);
    expect(new Set(words).size).toBe(205);
  });

  it('includes aliases the client uses, such as File Output (l.204-205) and Anisotropy (l.23-24)', () => {
    expect(words).toEqual(expect.arrayContaining(['Add', 'Anisotropy', 'File Output', 'Height Output']));
  });

  it('leaves out a refused word and anything after phase A', () => {
    const transcript = [
      '>>> device add Gradient',
      "Added 'Gradient'",
      '<<<',
      '>>> device add NoSuchDeviceType',
      // raw/p2c-edits.txt l.17-18.
      "Error: Error: Device type not found: 'NoSuchDeviceType'",
      '<<<',
      '>>> (phase A)',
      '<<<',
      '>>> device add Combiner',
      "Added 'Combiner'",
      '<<<',
    ].join('\n');
    expect(acceptedAddWords(transcript)).toEqual(['Gradient']);
  });
});

describe('probeCommands (port-types plan decisions D10 and D20)', () => {
  it('sends the connect, the destination wire list, and a disconnect from every input, checked', () => {
    expect(probeCommands(GRADIENT, EXISTING_WATER, false)).toEqual([
      'wire connect #1.1 #2.2',
      'wire list #2',
      'wire disconnect #1.1 #2.1',
      'wire disconnect #1.1 #2.2',
      'wire disconnect #1.1 #2.3',
    ]);
  });

  it('sends the connect and the disconnect of the same wire, lean', () => {
    expect(probeCommands(GRADIENT, EXISTING_WATER, true)).toEqual([
      'wire connect #1.1 #2.2',
      'wire disconnect #1.1 #2.2',
    ]);
  });
});

describe('probeVerdict (port-types plan decision D11, Codex round 1 rulings B2, B3, and S2)', () => {
  it('reads the exact refusal with a free input as refused (raw/create-water-sea.txt l.194-195)', () => {
    expect(probeVerdict(GRADIENT, EXISTING_WATER, [section(INCOMPATIBLE), wireList(), ...SWEEP], false)).toBe(
      'refused',
    );
  });

  it('reads the exact confirmation with the wire on that input only as connected (raw/p2b-graph-edits.txt l.22-23)', () => {
    const answers = [section("Connected '#1' [1] -> '#2' [1]"), wireList({ 1: "'Gradient' [1]" }), ...SWEEP];
    expect(probeVerdict(GRADIENT, TERRAIN, answers, false)).toBe('connected');
  });

  it('drops log lines before reading an answer (src/domain/errors.ts LOG_LINE)', () => {
    const answers = [section('[Info      ] Graph changed', INCOMPATIBLE), wireList(), ...SWEEP];
    expect(probeVerdict(GRADIENT, EXISTING_WATER, answers, false)).toBe('refused');
  });

  it('records a refusal that shows the source on another input as refused stray, which the parser rejects', () => {
    const answers = [section(INCOMPATIBLE), wireList({ 3: "'Gradient' [1]" }), ...SWEEP];
    expect(probeVerdict(GRADIENT, EXISTING_WATER, answers, false)).toBe('refused stray #2.3');
  });

  it('reads a connect and its disconnect in the lean mode (plan decision D20)', () => {
    expect(probeVerdict(GRADIENT, EXISTING_WATER, [section(INCOMPATIBLE), disconnected(2)], true)).toBe(
      'refused',
    );
    expect(
      probeVerdict(GRADIENT, TERRAIN, [section("Connected '#1' [1] -> '#2' [1]"), disconnected(1)], true),
    ).toBe('connected');
  });

  it.each<[string, (ProbeSection | undefined)[]]>([
    [
      'another connect answer',
      [section("Error: Error: Input '#2.2' is already connected. Disconnect first."), wireList(), ...SWEEP],
    ],
    [
      'an unconfirmed disconnect',
      [section(INCOMPATIBLE), wireList(), disconnected(1), section(), disconnected(3)],
    ],
    [
      'a wire list that is an error',
      [section(INCOMPATIBLE), section("Error: Error: Device not found: '#2'"), ...SWEEP],
    ],
    ['a missing wire list', [section(INCOMPATIBLE), undefined, ...SWEEP]],
    [
      'a wire list with a line it cannot read',
      [section(INCOMPATIBLE), section(...wireList().lines, 'Something else'), ...SWEEP],
    ],
    [
      'a wire list without the input',
      [
        section(INCOMPATIBLE),
        section(...wireList().lines.filter((line) => !line.includes('Existing Water'))),
        ...SWEEP,
      ],
    ],
    [
      'a confirmed wire the wire list does not show',
      [section("Connected '#1' [1] -> '#2' [2]"), wireList(), ...SWEEP],
    ],
  ])('records %s as an error, never as refused (Codex round 1 ruling B3)', (_label, answers) => {
    expect(probeVerdict(GRADIENT, EXISTING_WATER, answers, false)).toMatch(/^error: /);
  });
});

describe('readProbeWireList (Codex round 1 ruling B3)', () => {
  it('reads every port and the source of each input', () => {
    expect(readProbeWireList(wireList({ 1: "'Gradient' [1]" }))).toEqual({
      inputs: [
        { port: 1, source: "'Gradient' [1]" },
        { port: 2, source: '(none)' },
        { port: 3, source: '(none)' },
      ],
      outputs: [{ port: 1 }, { port: 2 }, { port: 3 }, { port: 4 }],
    });
  });

  it('reads nothing from a missing section, an error, or a line that is no port row', () => {
    expect(readProbeWireList(undefined)).toBeUndefined();
    expect(readProbeWireList(section("Error: Error: Device not found: '#2'"))).toBeUndefined();
    expect(readProbeWireList(section(...wireList().lines, 'Something else'))).toBeUndefined();
  });
});
