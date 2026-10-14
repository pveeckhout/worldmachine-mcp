import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parsePortTypeCatalog } from '../../scripts/port-type-catalog.mjs';
import { PORT_TYPE_CATALOG } from '../../src/adapter/out/worldmachine/world-machine-port-types.js';

const systemInfo = readFileSync(new URL('../fixtures/wm-4067/raw/system-info.txt', import.meta.url), 'utf8');

/**
 * Synthetic devices and verdicts (port-types plan decision D1): no port-type capture exists before plan Task 11. The
 * transcript has the shape of the plan Task 10 scenario: device rows as raw/device-list-sample.txt, ports as
 * raw/create-water.txt l.122-133, and one verdict line per pair (plan decision D11). Each output has a kind and each
 * input name accepts some kinds, so every verdict follows from the device table.
 */
type Output = { readonly name: string; readonly kind: string };
type Device = {
  readonly id: number;
  /** The listed type: the name a new device gets and its device list row shows. */
  readonly type: string;
  /** The word given to `device add`; the type when absent (Codex round 1 ruling B1). */
  readonly word?: string;
  readonly inputs: readonly string[];
  readonly outputs: readonly Output[];
};
const ACCEPTS: Readonly<Record<string, readonly string[]>> = {
  'Height In': ['height'],
  'Water In': ['water'],
  'Any In': ['height', 'mask'],
};
const MIXER_PORTS = ['Height In', 'Water In', 'Any In'];
const HEIGHT: Device = {
  id: 1,
  type: 'Height Source',
  inputs: [],
  outputs: [{ name: 'Height', kind: 'height' }],
};
const WATER: Device = {
  id: 2,
  type: 'Water Source',
  inputs: [],
  outputs: [{ name: 'Water', kind: 'water' }],
};
const MASK: Device = { id: 3, type: 'Mask Source', inputs: [], outputs: [{ name: 'Mask', kind: 'mask' }] };
const MIXER: Device = {
  id: 4,
  type: 'Mixer',
  inputs: MIXER_PORTS,
  outputs: [{ name: 'Mixed', kind: 'height' }],
};
const SINK: Device = { id: 5, type: 'Sink', inputs: MIXER_PORTS, outputs: [] };
const DEVICES: readonly Device[] = [HEIGHT, WATER, MASK, MIXER, SINK];

/** Whether the output `#<id>.<port>` is probed in a transcript. */
type Outputs = (from: string) => boolean;
/** A pair's verdict line text; undefined leaves the pair out. */
type Verdict = (pair: string) => string | undefined;
const PAIR = /^#(\d+)\.(\d+)>#(\d+)\.(\d+)$/;
/** `connected` when the input's name accepts the output's kind, else `refused`. */
const plainFor =
  (devices: readonly Device[]): Verdict =>
  (pair) => {
    const [, from, output, to, input] = PAIR.exec(pair) ?? [];
    const kind = devices.find((device) => device.id === Number(from))?.outputs[Number(output) - 1]?.kind;
    const name = devices.find((device) => device.id === Number(to))?.inputs[Number(input) - 1];
    return kind !== undefined && name !== undefined && (ACCEPTS[name] ?? []).includes(kind)
      ? 'connected'
      : 'refused';
  };
const plain = plainFor(DEVICES);

const section = (command: string, lines: readonly string[] = []) =>
  [`>>> ${command}`, ...lines, '<<<'].join('\n');
// raw/p2a-edge-cases.txt l.77: an empty project's answer (Codex round 3 ruling); otherwise rows as above.
const deviceList = (devices: readonly Device[]) =>
  section(
    'device list',
    devices.length === 0
      ? ['No devices in the current project.']
      : [
          `Devices (${devices.length} total):`,
          ...devices.map((device) => `  ${`#${device.id}`.padEnd(7)}${device.type.padEnd(24)}`),
        ],
  );
const wireList = (device: Device, wired: ReadonlyMap<number, string> = new Map()) =>
  section(`wire list #${device.id}`, [
    `Connections for '#${device.id}':`,
    '  Inputs:',
    ...device.inputs.map(
      (name, index) => `    [${index + 1}] ${name.padEnd(12)} <- ${wired.get(index + 1) ?? '(none)'}`,
    ),
    '  Outputs:',
    ...device.outputs.map((output, index) => `    [${index + 1}] ${output.name.padEnd(12)} -> (none)`),
  ]);
/** Design section 3 step 1: a blank project, then each add and the device list after it. */
const added = (devices: readonly Device[]) => [
  section('project new blank force'),
  deviceList([]),
  ...devices.flatMap((device, index) => [
    section(`device add ${device.word ?? device.type}`, [`Added '${device.type}'`]),
    deviceList(devices.slice(0, index + 1)),
  ]),
];
/**
 * Design section 3 step 3 as plan decision D11 records it: a section per output, a line per other input, among the
 * first device of each listed type only (B1 addendum ruling).
 */
const probed = (devices: readonly Device[], verdict: Verdict, outputs: Outputs = () => true) => {
  const firsts = devices.filter(
    (device, index) => devices.findIndex((other) => other.type === device.type) === index,
  );
  return firsts.flatMap((source) =>
    source.outputs.flatMap((_output, output) => {
      const from = `#${source.id}.${output + 1}`;
      if (!outputs(from)) return [];
      const lines = firsts
        .filter((target) => target.id !== source.id)
        .flatMap((target) =>
          target.inputs.flatMap((_input, input) => {
            const to = `#${target.id}.${input + 1}`;
            const answer = verdict(`${from}>${to}`);
            return answer === undefined ? [] : [`${to} ${answer}`];
          }),
        );
      return [section(`(probe ${from})`, lines)];
    }),
  );
};
/**
 * Steps 1-3, the step-2 wire lists after every add (plan decision D11), and the close; `outputs` picks the probed
 * outputs, as a transcript that stopped or resumed (design section 3, crashes and resumes) holds only some.
 */
const transcript = (
  devices: readonly Device[] = DEVICES,
  verdict: Verdict = plainFor(devices),
  outputs: Outputs = () => true,
) =>
  [
    ...added(devices),
    ...devices.map((device) => wireList(device)),
    ...probed(devices, verdict, outputs),
    section('project close force'),
  ].join('\n');

const entry = (port: number, name: string, portClass: string) => ({ port, name, class: portClass });
const MIXER_INPUTS = [entry(1, 'Height In', 'i1'), entry(2, 'Water In', 'i2'), entry(3, 'Any In', 'i3')];
// Mixed is accepted where Height is (by Sink, the only other device with inputs), so it joins Height's class.
const CATALOG = {
  build: 4067,
  outputClasses: {
    o1: 'like Height Source Height',
    o2: 'like Water Source Water',
    o3: 'like Mask Source Mask',
  },
  inputClasses: { i1: ['o1'], i2: ['o2'], i3: ['o1', 'o3'] },
  types: {
    'Height Source': { added: ['Height Source'], inputs: [], outputs: [entry(1, 'Height', 'o1')] },
    'Water Source': { added: ['Water Source'], inputs: [], outputs: [entry(1, 'Water', 'o2')] },
    'Mask Source': { added: ['Mask Source'], inputs: [], outputs: [entry(1, 'Mask', 'o3')] },
    Mixer: { added: ['Mixer'], inputs: MIXER_INPUTS, outputs: [entry(1, 'Mixed', 'o1')] },
    Sink: { added: ['Sink'], inputs: MIXER_INPUTS, outputs: [] },
  },
};

describe('parsePortTypeCatalog (port-types design section 4)', () => {
  it('finds three output classes and an input class that accepts two of them', () => {
    expect(parsePortTypeCatalog([transcript()], systemInfo)).toEqual(CATALOG);
  });

  it('records every add word of a type, probing only its first device (Codex round 1 ruling B1 and addendum)', () => {
    // raw/v3-rename-types.txt l.23-24 and l.204-205: Anisotropy adds a VDM Features, File Output a Height Output;
    // here a synthetic `Blender` adds a Mixer, whose ports are listed and not probed.
    const blender: Device = { ...MIXER, id: 6, word: 'Blender' };
    expect(parsePortTypeCatalog([transcript([...DEVICES, blender])], systemInfo)).toEqual({
      ...CATALOG,
      types: { ...CATALOG.types, Mixer: { ...CATALOG.types.Mixer, added: ['Mixer', 'Blender'] } },
    });
  });

  it('fails on an add word whose device shows other port names (Codex round 1 ruling B1 addendum)', () => {
    const blender: Device = { ...MIXER, id: 6, word: 'Blender', inputs: ['Height In', 'Water In'] };
    expect(() => parsePortTypeCatalog([transcript([...DEVICES, blender])], systemInfo)).toThrow(
      "type 'Mixer': 'Blender' gives other ports than 'Mixer'",
    );
  });

  it('fails on a refusal recorded with a stray wire (design section 2, Codex round 1 ruling B2)', () => {
    const stray: Verdict = (pair) => (pair === '#1.1>#4.2' ? 'refused stray #4.1' : plain(pair));
    expect(() => parsePortTypeCatalog([transcript(DEVICES, stray)], systemInfo)).toThrow(
      '#1.1 -> #4.2: refused stray #4.1',
    );
  });

  it('skips a type recorded as not added (design section 3 step 1, plan decision D13)', () => {
    // raw/p2c-edits.txt l.17-18: World Machine's answer to a type it does not know.
    const refusal = "Error: Error: Device type not found: 'Nothing'";
    const sections = added(DEVICES);
    sections.splice(
      4,
      0,
      section('device add Nothing', [refusal]),
      deviceList([HEIGHT]),
      section('(type Nothing not added)', [refusal]),
    );
    const text = [...sections, ...DEVICES.map((device) => wireList(device)), ...probed(DEVICES, plain)].join(
      '\n',
    );
    expect(parsePortTypeCatalog([text], systemInfo)).toEqual(CATALOG);
  });

  it('fails on a pair recorded as an error (design section 4)', () => {
    const error: Verdict = (pair) =>
      pair === '#1.1>#4.1' ? 'error: connect [Error: Error: Unexpected]' : plain(pair);
    expect(() => parsePortTypeCatalog([transcript(DEVICES, error)], systemInfo)).toThrow(
      '#1.1 -> #4.1: connect [Error: Error: Unexpected]',
    );
  });

  it('fails on a pair of two devices that was not probed (plan decision D13)', () => {
    const gap: Verdict = (pair) => (pair === '#2.1>#5.3' ? undefined : plain(pair));
    expect(() => parsePortTypeCatalog([transcript(DEVICES, gap)], systemInfo)).toThrow(
      '#2.1 -> #5.3: not probed',
    );
  });

  it.each(['(type Mixer stopped)', '(scenario stopped)'])(
    'fails when the capture recorded %s (plan decision D13)',
    (command) => {
      const text = `${transcript()}\n${section(command, ['timed out waiting for batch 1a2b3c4d'])}`;
      expect(() => parsePortTypeCatalog([text], systemInfo)).toThrow(
        `the capture did not complete: ${command}`,
      );
    },
  );

  it('fails on an output whose row has no known cell, however many classes exist (design section 4)', () => {
    // Without Sink, every input Mixed could feed is on the Mixer itself, so its row is all unknown.
    expect(() => parsePortTypeCatalog([transcript([HEIGHT, WATER, MASK, MIXER])], systemInfo)).toThrow(
      "output 'Mixer.Mixed': no probed cell",
    );
  });

  it('fails on an input wired before probing (plan decision D11, Review Focus 5)', () => {
    const text = transcript().replace(
      wireList(MIXER),
      wireList(MIXER, new Map([[1, "'Height Source' [1]"]])),
    );
    expect(() => parsePortTypeCatalog([text], systemInfo)).toThrow(
      'wire list #4: input 1 is wired before probing',
    );
  });

  it('fails on a device list row it cannot read (Codex round 2 ruling 1)', () => {
    const text = transcript().replace(
      deviceList([HEIGHT]),
      `${deviceList([HEIGHT]).slice(0, -3)}Something else\n<<<`,
    );
    expect(() => parsePortTypeCatalog([text], systemInfo)).toThrow(
      "device list: unreadable row 'Something else'",
    );
  });

  it.each([
    ['a device', ['Devices (1 total):', '  #99    Leftover                ']],
    ['a header without rows', ['Devices (0 total):']],
  ])(
    'fails on a blank project whose first device list shows %s (Codex round 2 ruling 1, round 3 ruling)',
    (_label, lines) => {
      const text = transcript().replace(deviceList([]), section('device list', lines));
      expect(() => parsePortTypeCatalog([text], systemInfo)).toThrow(
        "device list after project new blank force: not 'No devices in the current project.'",
      );
    },
  );

  it('fails on a line printed between batches that is no log line (Codex round 2 ruling 1)', () => {
    const text = `${transcript()}\n${section('(printed between batches)', ['Something else'])}`;
    expect(() => parsePortTypeCatalog([text], systemInfo)).toThrow(
      "(printed between batches): unexpected line 'Something else'",
    );
  });

  it('accepts log and build event lines printed between batches (Codex round 2 ruling 1)', () => {
    // Shapes of raw/v2-build-long.txt build events and of the `[Info ...]` lines other captures print between batches.
    const printed = section('(printed between batches)', [
      '[Info       ] Graph changed',
      '[Build Event] Prohibiting system sleep',
    ]);
    expect(parsePortTypeCatalog([`${transcript()}\n${printed}`], systemInfo)).toEqual(CATALOG);
  });

  it('takes the build only from the system info capture (design section 4)', () => {
    expect(() => parsePortTypeCatalog([transcript()], '')).toThrow('expected one Version line, found 0');
  });
});

/**
 * Design section 3, crashes and resumes: the full build 4067 run crashed World Machine (SIGSEGV) while probing #185.1,
 * so its outputs come from two transcripts. Synthetic transcripts of that shape; the exit message as the capture
 * script records it (scripts/capture-fixtures.mjs startWorldMachine).
 */
describe('parsePortTypeCatalog holes (port-types design section 4)', () => {
  it('fails on a port whose row has no probed cell instead of letting it join a class', () => {
    // Synthetic: no device has an input, so no pair exists and every output row is empty.
    expect(() => parsePortTypeCatalog([transcript([HEIGHT, MASK])], systemInfo)).toThrow(
      "output 'Height Source.Height': no probed cell",
    );
  });
});

describe('parsePortTypeCatalog of several transcripts (port-types design sections 3 and 4)', () => {
  const early: Outputs = (from) => ['#1.1', '#2.1'].includes(from);
  const late: Outputs = (from) => !early(from);
  /** `(probe <from> stopped)` in place of each output `stopped` picks. */
  const stoppedAt = (stopped: Outputs) =>
    `${transcript(DEVICES, plain, (from) => !stopped(from))}\n${['#1.1', '#2.1', '#3.1', '#4.1']
      .filter(stopped)
      .map((from) => section(`(probe ${from} stopped)`, ['World Machine exited (code null, signal SIGSEGV)']))
      .join('\n')}`;

  it('gives the catalog of one transcript when two split the outputs', () => {
    expect(
      parsePortTypeCatalog([transcript(DEVICES, plain, early), transcript(DEVICES, plain, late)], systemInfo),
    ).toEqual(CATALOG);
  });

  it('accepts a pair probed alike in two transcripts', () => {
    expect(parsePortTypeCatalog([transcript(), transcript(DEVICES, plain, late)], systemInfo)).toEqual(
      CATALOG,
    );
  });

  it('fails when two transcripts list other devices', () => {
    const blender: Device = { ...MIXER, id: 6, word: 'Blender' };
    expect(() => parsePortTypeCatalog([transcript(), transcript([...DEVICES, blender])], systemInfo)).toThrow(
      "transcript 2: #6 'Mixer' (device add Blender) inputs 1 Height In, 2 Water In, 3 Any In outputs 1 Mixed " +
        'where transcript 1 has no device',
    );
  });

  it('fails when two transcripts list other ports', () => {
    const narrow: Device = { ...SINK, inputs: ['Height In', 'Water In'] };
    expect(() =>
      parsePortTypeCatalog([transcript(), transcript([HEIGHT, WATER, MASK, MIXER, narrow])], systemInfo),
    ).toThrow(
      "transcript 2: #5 'Sink' (device add Sink) inputs 1 Height In, 2 Water In outputs none where transcript 1 has " +
        "#5 'Sink' (device add Sink) inputs 1 Height In, 2 Water In, 3 Any In outputs none",
    );
  });

  it('fails on a pair two transcripts probed differently', () => {
    const flipped: Verdict = (pair) => (pair === '#1.1>#4.1' ? 'refused' : plain(pair));
    expect(() =>
      parsePortTypeCatalog([transcript(), transcript(DEVICES, flipped, late)], systemInfo),
    ).not.toThrow();
    expect(() =>
      parsePortTypeCatalog([transcript(), transcript(DEVICES, flipped, early)], systemInfo),
    ).toThrow('#1.1 -> #4.1: probed differently');
  });

  it('accepts a stopped probe another transcript covers', () => {
    expect(parsePortTypeCatalog([stoppedAt(late), transcript(DEVICES, plain, late)], systemInfo)).toEqual(
      CATALOG,
    );
  });

  it('fails on a stopped probe no transcript covers', () => {
    expect(() => parsePortTypeCatalog([stoppedAt((from) => from === '#4.1')], systemInfo)).toThrow(
      '#4.1 -> #5.1: not probed',
    );
  });

  it('keeps the answered pairs of a probe that stopped after them, its other pairs left to another transcript', () => {
    // scripts/capture-fixtures.mjs probeOutputs: the verdicts gathered before a stop, then the stopped section.
    const partly: Verdict = (pair) =>
      pair.startsWith('#4.1>#5.') && pair !== '#4.1>#5.1' ? undefined : plain(pair);
    const text = `${transcript(DEVICES, partly)}\n${section('(probe #4.1 stopped)', ['timed out waiting for batch 1a2b3c4d'])}`;
    expect(() => parsePortTypeCatalog([text], systemInfo)).toThrow('#4.1 -> #5.2: not probed');
    expect(
      parsePortTypeCatalog([text, transcript(DEVICES, plain, (from) => from === '#4.1')], systemInfo),
    ).toEqual(CATALOG);
    const flipped: Verdict = (pair) => (pair === '#4.1>#5.1' ? 'refused' : plain(pair));
    expect(() =>
      parsePortTypeCatalog([text, transcript(DEVICES, flipped, (from) => from === '#4.1')], systemInfo),
    ).toThrow('#4.1 -> #5.1: probed differently');
  });

  it('fails on an output whose only pairs crashed, since a hole decides no class (design section 4)', () => {
    // As the same-device hole test above: with Mixed's pairs into Sink crashed, its row is all unknown.
    const crashed: Verdict = (pair) => (pair.startsWith('#4.1>#5.') ? 'crashed' : plain(pair));
    expect(() => parsePortTypeCatalog([transcript(DEVICES, crashed)], systemInfo)).toThrow(
      "output 'Mixer.Mixed': no probed cell",
    );
  });

  it('ignores a (restarted ...) section', () => {
    const restarted = section('(restarted after #1.1 -> #4.2)', [
      'World Machine exited (code null, signal SIGSEGV)',
      're-added 5 devices, list unchanged',
    ]);
    expect(parsePortTypeCatalog([`${transcript()}\n${restarted}`], systemInfo)).toEqual(CATALOG);
  });
});

/**
 * Design section 3, same-device holes: the merged build 4067 run failed on `output 'River.GCS Covariance' matches 2
 * classes`, two classes that differ only at River's own input `River Parameters`. Synthetic devices of that shape:
 * `River` (id 8) has the one input that tells Height from Mask, and its output is a mask, so only a pair on River
 * itself decides it. The `port-types-self` transcript (scripts/capture-fixtures.mjs portTypesBody) repeats the
 * opening, then a `(twin #<probed id> #<twin id>)` section per twin holding the twin's `wire list` answer, and a
 * `(probe ...)` section per output of a twinned device with a verdict line per input of its twin.
 */
describe('parsePortTypeCatalog of twin probes (port-types design section 3, same-device holes)', () => {
  const RIVER: Device = {
    id: 8,
    type: 'River',
    inputs: ['Height In'],
    outputs: [{ name: 'Covariance', kind: 'mask' }],
  };
  const ANY: Device = { id: 9, type: 'Any Sink', inputs: ['Any In'], outputs: [] };
  const SELF: readonly Device[] = [HEIGHT, MASK, RIVER, ANY];
  const TWIN = 10;
  /** The twin's `wire list` answer: its probed device's ports under the twin's id. */
  const twinList = (device: Device, id: number) =>
    wireList({ ...device, id })
      .split('\n')
      .slice(1, -1);
  /** The self transcript: the opening, the twin section, and one probe of River's output against its twin's input. */
  const self = (verdict = 'refused', twin = section(`(twin #8 #${TWIN})`, twinList(RIVER, TWIN))) =>
    [
      ...added(SELF),
      ...SELF.map((device) => wireList(device)),
      twin,
      section('(probe #8.1)', [`#${TWIN}.1 ${verdict}`]),
      section('project close force'),
    ].join('\n');

  it('fails on an output whose classes differ only at its own device without a twin verdict', () => {
    expect(() => parsePortTypeCatalog([transcript(SELF)], systemInfo)).toThrow(
      "output 'River.Covariance' matches 2 classes: like Height Source Height, like Mask Source Mask",
    );
  });

  it("reads a twin verdict as the cell of the probed device's own pair", () => {
    const catalog = parsePortTypeCatalog([transcript(SELF), self()], systemInfo);
    expect(catalog.outputClasses).toEqual({ o1: 'like Height Source Height', o2: 'like Mask Source Mask' });
    expect(catalog.types.River?.outputs).toEqual([entry(1, 'Covariance', 'o2')]);
    expect(catalog.inputClasses).toEqual({ i1: ['o1'], i2: ['o1', 'o2'] });
  });

  it('fails on a twin whose ports differ from its probed device', () => {
    const other = section(`(twin #8 #${TWIN})`, twinList({ ...RIVER, inputs: ['Water In'] }, TWIN));
    expect(() => parsePortTypeCatalog([transcript(SELF), self('refused', other)], systemInfo)).toThrow(
      `twin #${TWIN} of #8: other ports than its probed device`,
    );
  });

  // Pins existing guards (Final review deferred minor 33): GREEN on the first run is expected.
  it('fails on a twin of a device the capture did not probe', () => {
    const text = self().replace(`(twin #8 #${TWIN})`, `(twin #99 #${TWIN})`);
    expect(() => parsePortTypeCatalog([transcript(SELF), text], systemInfo)).toThrow(
      `(twin #99 #${TWIN}): not a probed device`,
    );
  });

  it('fails on a twin whose id is a listed device', () => {
    const text = self().replace(`(twin #8 #${TWIN})`, '(twin #8 #1)');
    expect(() => parsePortTypeCatalog([transcript(SELF), text], systemInfo)).toThrow(
      '(twin #8 #1): not a new device',
    );
  });

  it('fails on a twin verdict in the probe of another source', () => {
    const text = self().replace('(probe #8.1)', '(probe #1.1)');
    expect(() => parsePortTypeCatalog([transcript(SELF), text], systemInfo)).toThrow(
      `#1.1 -> #${TWIN}.1: an input of the twin of #8`,
    );
  });

  it('leaves the pair a hole when the twin was not added', () => {
    // scripts/capture-fixtures.mjs: a twin add that shows no new device is recorded with the add's answer lines.
    const stopped = [
      ...added(SELF),
      ...SELF.map((device) => wireList(device)),
      section('(twin #8 stopped)', ["Error: Error: Device type not found: 'River'"]),
      section('project close force'),
    ].join('\n');
    expect(() => parsePortTypeCatalog([transcript(SELF), stopped], systemInfo)).toThrow(
      "output 'River.Covariance' matches 2 classes",
    );
  });

  it('fails on a twin verdict two transcripts give differently', () => {
    expect(() => parsePortTypeCatalog([transcript(SELF), self(), self('connected')], systemInfo)).toThrow(
      '#8.1 -> #8.1: probed differently',
    );
  });

  it('leaves a crashed twin pair a hole', () => {
    expect(() => parsePortTypeCatalog([transcript(SELF), self('crashed')], systemInfo)).toThrow(
      "output 'River.Covariance' matches 2 classes",
    );
  });
});

// Synthetic (plan decision D1): two outputs of one type with one name, in two classes.
const SPLITTER: Device = {
  id: 7,
  type: 'Splitter',
  inputs: [],
  outputs: [
    { name: 'Part', kind: 'height' },
    { name: 'Part', kind: 'water' },
  ],
};

describe('parsePortTypeCatalog names (port-types design section 4, plan decision D14)', () => {
  it('names a class by any of its ports and leaves the others to their first port', () => {
    expect(
      parsePortTypeCatalog([transcript()], systemInfo, { 'Mixer.Mixed': 'heightfield' }).outputClasses,
    ).toEqual({
      o1: 'heightfield',
      o2: 'like Water Source Water',
      o3: 'like Mask Source Mask',
    });
  });

  it('fails on an entry that names no output port', () => {
    expect(() =>
      parsePortTypeCatalog([transcript()], systemInfo, { 'Mixer.Height In': 'heightfield' }),
    ).toThrow("names: 'Mixer.Height In' names no output port");
  });

  it('fails on two entries for one class', () => {
    expect(() =>
      parsePortTypeCatalog([transcript()], systemInfo, {
        'Height Source.Height': 'heightfield',
        'Mixer.Mixed': 'height',
      }),
    ).toThrow("names: 'Height Source.Height' and 'Mixer.Mixed' name one class");
  });

  it('fails on an entry that names ports of two classes', () => {
    const text = transcript([...DEVICES, SPLITTER]);
    expect(() => parsePortTypeCatalog([text], systemInfo, { 'Splitter.Part': 'part' })).toThrow(
      "names: 'Splitter.Part' names ports of 2 classes",
    );
  });
});

const script = fileURLToPath(new URL('../../scripts/build-port-type-catalog.mjs', import.meta.url));
const NAMES = { 'Height Source.Height': 'heightfield', 'Water Source.Water': 'water system' };

/**
 * Runs the script on the synthetic transcripts in a fresh directory, beside `info` unless it is null (section 4), the
 * names map first so the script has to find it by its extension.
 */
function generate(
  names?: Readonly<Record<string, string>>,
  info: string | null = systemInfo,
  transcripts: readonly string[] = [transcript()],
) {
  const dir = mkdtempSync(join(tmpdir(), 'port-type-catalog-'));
  try {
    if (info !== null) writeFileSync(join(dir, 'system-info.txt'), info);
    const args = [script];
    if (names !== undefined) {
      writeFileSync(join(dir, 'names.json'), JSON.stringify(names));
      args.push(join(dir, 'names.json'));
    }
    for (const [index, text] of transcripts.entries()) {
      writeFileSync(join(dir, `port-types-${index + 1}.txt`), text);
      args.push(join(dir, `port-types-${index + 1}.txt`));
    }
    return spawnSync(process.execPath, args, { encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('scripts/build-port-type-catalog.mjs (port-types design section 4, plan decision D16)', () => {
  it('prints the catalog the transcript, its system info, and the names map parse to', () => {
    const result = generate(NAMES);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toStrictEqual(parsePortTypeCatalog([transcript()], systemInfo, NAMES));
  });

  it('prints the fallback names without a names map', () => {
    const result = generate();
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toStrictEqual(CATALOG);
  });

  it('merges every transcript given (design section 3, crashes and resumes)', () => {
    const split = (outputs: Outputs) => transcript(DEVICES, plain, outputs);
    const result = generate(NAMES, systemInfo, [
      split((from) => from === '#1.1'),
      split((from) => from !== '#1.1'),
    ]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toStrictEqual(parsePortTypeCatalog([transcript()], systemInfo, NAMES));
  });

  it.each([
    ['no transcript is given', ['names.json']],
    ['two names maps are given', ['port-types.txt', 'a.json', 'b.json']],
  ])('exits 2 with a usage line when %s', (_label, args) => {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(
      'usage: node scripts/build-port-type-catalog.mjs <transcript>... [names.json]',
    );
  });

  it('prints nothing on stdout when the names map fails', () => {
    const result = generate({ 'Mixer.Nope': 'x' });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain("names: 'Mixer.Nope' names no output port");
  });

  it('prints nothing on stdout when no system-info.txt lies beside the transcript', () => {
    const result = generate(undefined, null);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('system-info.txt');
  });
});

describe('the shipped port-type catalog (port-types design section 4)', () => {
  const transcripts = ['port-types.txt', 'port-types-resume.txt', 'port-types-self.txt'].map((file) =>
    readFileSync(new URL(`../fixtures/wm-4067/raw/${file}`, import.meta.url), 'utf8'),
  );
  const names = JSON.parse(
    readFileSync(new URL('../../scripts/port-type-names.4067.json', import.meta.url), 'utf8'),
  ) as Record<string, string>;

  it('is exactly what raw/port-types*.txt (the full run, its resume, and the twin run) and the names map parse to (parity)', () => {
    expect(PORT_TYPE_CATALOG).toStrictEqual(parsePortTypeCatalog(transcripts, systemInfo, names));
  });

  it('is the catalog of build 4067', () => {
    expect(PORT_TYPE_CATALOG?.build).toBe(4067);
  });
});
