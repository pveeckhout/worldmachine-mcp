import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parsePortTypeCatalog } from '../../scripts/port-type-catalog.mjs';

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
const probed = (devices: readonly Device[], verdict: Verdict) => {
  const firsts = devices.filter(
    (device, index) => devices.findIndex((other) => other.type === device.type) === index,
  );
  return firsts.flatMap((source) =>
    source.outputs.map((_output, output) => {
      const from = `#${source.id}.${output + 1}`;
      const lines = firsts
        .filter((target) => target.id !== source.id)
        .flatMap((target) =>
          target.inputs.flatMap((_input, input) => {
            const to = `#${target.id}.${input + 1}`;
            const answer = verdict(`${from}>${to}`);
            return answer === undefined ? [] : [`${to} ${answer}`];
          }),
        );
      return section(`(probe ${from})`, lines);
    }),
  );
};
/** Steps 1-3, the step-2 wire lists after every add (plan decision D11), and the close. */
const transcript = (devices: readonly Device[] = DEVICES, verdict: Verdict = plainFor(devices)) =>
  [
    ...added(devices),
    ...devices.map((device) => wireList(device)),
    ...probed(devices, verdict),
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
    expect(parsePortTypeCatalog(transcript(), systemInfo)).toEqual(CATALOG);
  });

  it('records every add word of a type, probing only its first device (Codex round 1 ruling B1 and addendum)', () => {
    // raw/v3-rename-types.txt l.23-24 and l.204-205: Anisotropy adds a VDM Features, File Output a Height Output;
    // here a synthetic `Blender` adds a Mixer, whose ports are listed and not probed.
    const blender: Device = { ...MIXER, id: 6, word: 'Blender' };
    expect(parsePortTypeCatalog(transcript([...DEVICES, blender]), systemInfo)).toEqual({
      ...CATALOG,
      types: { ...CATALOG.types, Mixer: { ...CATALOG.types.Mixer, added: ['Mixer', 'Blender'] } },
    });
  });

  it('fails on an add word whose device shows other port names (Codex round 1 ruling B1 addendum)', () => {
    const blender: Device = { ...MIXER, id: 6, word: 'Blender', inputs: ['Height In', 'Water In'] };
    expect(() => parsePortTypeCatalog(transcript([...DEVICES, blender]), systemInfo)).toThrow(
      "type 'Mixer': 'Blender' gives other ports than 'Mixer'",
    );
  });

  it('fails on a refusal recorded with a stray wire (design section 2, Codex round 1 ruling B2)', () => {
    const stray: Verdict = (pair) => (pair === '#1.1>#4.2' ? 'refused stray #4.1' : plain(pair));
    expect(() => parsePortTypeCatalog(transcript(DEVICES, stray), systemInfo)).toThrow(
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
    expect(parsePortTypeCatalog(text, systemInfo)).toEqual(CATALOG);
  });

  it('fails on a pair recorded as an error (design section 4)', () => {
    const error: Verdict = (pair) =>
      pair === '#1.1>#4.1' ? 'error: connect [Error: Error: Unexpected]' : plain(pair);
    expect(() => parsePortTypeCatalog(transcript(DEVICES, error), systemInfo)).toThrow(
      '#1.1 -> #4.1: connect [Error: Error: Unexpected]',
    );
  });

  it('fails on a pair of two devices that was not probed (plan decision D13)', () => {
    const gap: Verdict = (pair) => (pair === '#2.1>#5.3' ? undefined : plain(pair));
    expect(() => parsePortTypeCatalog(transcript(DEVICES, gap), systemInfo)).toThrow(
      '#2.1 -> #5.3: not probed',
    );
  });

  it('fails when the capture stopped (plan decision D13)', () => {
    const text = `${transcript()}\n${section('(probe #4.1 stopped)', ['timed out waiting for batch 1a2b3c4d'])}`;
    expect(() => parsePortTypeCatalog(text, systemInfo)).toThrow(
      'the capture did not complete: (probe #4.1 stopped)',
    );
  });

  it('fails on an output whose known cells match two classes (design section 4)', () => {
    // Without Sink, every input Mixed could feed is on the Mixer itself, so its row is all unknown.
    expect(() => parsePortTypeCatalog(transcript([HEIGHT, WATER, MASK, MIXER]), systemInfo)).toThrow(
      /output 'Mixer\.Mixed' matches 3 classes/,
    );
  });

  it('fails on an input wired before probing (plan decision D11, Review Focus 5)', () => {
    const text = transcript().replace(
      wireList(MIXER),
      wireList(MIXER, new Map([[1, "'Height Source' [1]"]])),
    );
    expect(() => parsePortTypeCatalog(text, systemInfo)).toThrow(
      'wire list #4: input 1 is wired before probing',
    );
  });

  it('fails on a device list row it cannot read (Codex round 2 ruling 1)', () => {
    const text = transcript().replace(
      deviceList([HEIGHT]),
      `${deviceList([HEIGHT]).slice(0, -3)}Something else\n<<<`,
    );
    expect(() => parsePortTypeCatalog(text, systemInfo)).toThrow(
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
      expect(() => parsePortTypeCatalog(text, systemInfo)).toThrow(
        "device list after project new blank force: not 'No devices in the current project.'",
      );
    },
  );

  it('fails on a line printed between batches that is no log line (Codex round 2 ruling 1)', () => {
    const text = `${transcript()}\n${section('(printed between batches)', ['Something else'])}`;
    expect(() => parsePortTypeCatalog(text, systemInfo)).toThrow(
      "(printed between batches): unexpected line 'Something else'",
    );
  });

  it('accepts log and build event lines printed between batches (Codex round 2 ruling 1)', () => {
    // Shapes of raw/v2-build-long.txt build events and of the `[Info ...]` lines other captures print between batches.
    const printed = section('(printed between batches)', [
      '[Info       ] Graph changed',
      '[Build Event] Prohibiting system sleep',
    ]);
    expect(parsePortTypeCatalog(`${transcript()}\n${printed}`, systemInfo)).toEqual(CATALOG);
  });

  it('takes the build only from the system info capture (design section 4)', () => {
    expect(() => parsePortTypeCatalog(transcript(), '')).toThrow('expected one Version line, found 0');
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
      parsePortTypeCatalog(transcript(), systemInfo, { 'Mixer.Mixed': 'heightfield' }).outputClasses,
    ).toEqual({
      o1: 'heightfield',
      o2: 'like Water Source Water',
      o3: 'like Mask Source Mask',
    });
  });

  it('fails on an entry that names no output port', () => {
    expect(() =>
      parsePortTypeCatalog(transcript(), systemInfo, { 'Mixer.Height In': 'heightfield' }),
    ).toThrow("names: 'Mixer.Height In' names no output port");
  });

  it('fails on two entries for one class', () => {
    expect(() =>
      parsePortTypeCatalog(transcript(), systemInfo, {
        'Height Source.Height': 'heightfield',
        'Mixer.Mixed': 'height',
      }),
    ).toThrow("names: 'Height Source.Height' and 'Mixer.Mixed' name one class");
  });

  it('fails on an entry that names ports of two classes', () => {
    const text = transcript([...DEVICES, SPLITTER]);
    expect(() => parsePortTypeCatalog(text, systemInfo, { 'Splitter.Part': 'part' })).toThrow(
      "names: 'Splitter.Part' names ports of 2 classes",
    );
  });
});

const script = fileURLToPath(new URL('../../scripts/build-port-type-catalog.mjs', import.meta.url));
const NAMES = { 'Height Source.Height': 'heightfield', 'Water Source.Water': 'water system' };

/** Runs the script on the synthetic transcript in a fresh directory, beside `info` unless it is null (section 4). */
function generate(names?: Readonly<Record<string, string>>, info: string | null = systemInfo) {
  const dir = mkdtempSync(join(tmpdir(), 'port-type-catalog-'));
  try {
    writeFileSync(join(dir, 'port-types.txt'), transcript());
    if (info !== null) writeFileSync(join(dir, 'system-info.txt'), info);
    const args = [script, join(dir, 'port-types.txt')];
    if (names !== undefined) {
      writeFileSync(join(dir, 'names.json'), JSON.stringify(names));
      args.push(join(dir, 'names.json'));
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
    expect(JSON.parse(result.stdout)).toStrictEqual(parsePortTypeCatalog(transcript(), systemInfo, NAMES));
  });

  it('prints the fallback names without a names map', () => {
    const result = generate();
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toStrictEqual(CATALOG);
  });

  it('exits 2 with a usage line when no transcript is given', () => {
    const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(
      'usage: node scripts/build-port-type-catalog.mjs <transcript> [names.json]',
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
