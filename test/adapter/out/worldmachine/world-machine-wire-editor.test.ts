import { describe, expect, it } from 'vitest';
import { WorldMachineWireEditor } from '../../../../src/adapter/out/worldmachine/world-machine-wire-editor.js';
import { scriptedSession } from '../../../support/scripted-session.js';

// raw/p2b-graph-edits.txt l.17-19.
const DEVICES = [
  'Devices (2 total):',
  '  #1     Gradient                ',
  '  #2     Combiner                ',
];
// raw/p2b-graph-edits.txt l.121-126: nothing connected.
const COMBINER_FREE = [
  "Connections for '#2':",
  '  Inputs:',
  '    [1] Primary Input <- (none)',
  '    [2] Primary Input <- (none)',
  '  Outputs:',
  '    [1] Primary Output -> (none)',
];
// raw/p2b-graph-edits.txt l.26-31: Gradient [1] -> Combiner [1].
const COMBINER_WIRED = [
  "Connections for '#2':",
  '  Inputs:',
  "    [1] Primary Input <- 'Gradient' [1]",
  '    [2] Primary Input <- (none)',
  '  Outputs:',
  '    [1] Primary Output -> (none)',
];
const GRADIENT_1 = { id: 1, name: 'Gradient', port: 1 };
const COMBINER_1 = { id: 2, name: 'Combiner', port: 1 };
// raw/v4-quoting.txt l.131-136 (and l.119-124): Combiner's input 1 wired from Gradient.
const V4_COMBINER_WIRED = [
  "Connections for 'Combiner':",
  '  Inputs:',
  "    [1] Primary Input <- 'Gradient' [1]",
  '    [2] Primary Input <- (none)',
  '  Outputs:',
  '    [1] Primary Output -> (none)',
];
// raw/p2c-edits.txt l.166-170: #4 renamed to 'Grad A', listed with its type as the kind (spec fact 32).
const P2C_DEVICES = [
  'Devices (4 total):',
  '  #1     Gradient                ',
  '  #2     Combiner                ',
  '  #3     Height Output           ',
  '  #4     Grad A                   (Gradient)',
];
// raw/p2c-edits.txt l.90-95: wire list names the renamed source by its current name (spec fact 34).
const P2C_COMBINER_FROM_GRAD_A = [
  "Connections for '#2':",
  '  Inputs:',
  "    [1] Primary Input <- 'Grad A' [1]",
  '    [2] Primary Input <- (none)',
  '  Outputs:',
  '    [1] Primary Output -> (none)',
];
// raw/p2c-edits.txt l.112-117.
const P2C_COMBINER_BOTH = [
  "Connections for '#2':",
  '  Inputs:',
  "    [1] Primary Input <- 'Grad A' [1]",
  "    [2] Primary Input <- 'Gradient' [1]",
  '  Outputs:',
  '    [1] Primary Output -> (none)',
];
// raw/p2c-edits.txt l.154-159.
const P2C_COMBINER_FREE = [
  "Connections for '#2':",
  '  Inputs:',
  '    [1] Primary Input <- (none)',
  '    [2] Primary Input <- (none)',
  '  Outputs:',
  '    [1] Primary Output -> (none)',
];

const editor = (s: ReturnType<typeof scriptedSession>) => new WorldMachineWireEditor(s.session);

describe('WorldMachineWireEditor.connect', () => {
  it('connects by name in another case on port 1 and reads the wire back', async () => {
    const s = scriptedSession({
      'device list': [{ output: DEVICES }],
      'wire list #2': [{ output: COMBINER_FREE }, { output: COMBINER_WIRED }],
      // raw/p2b-graph-edits.txt l.22-23.
      'wire connect #1 #2': [{ output: ["Connected '#1' [1] -> '#2' [1]"] }],
    });
    expect(await editor(s).connect({ device: 'gradient' }, { device: 'Combiner' })).toEqual({
      source: GRADIENT_1,
      destination: COMBINER_1,
      created: true,
    });
    expect(s.batches).toEqual([['device list'], ['wire list #2'], ['wire connect #1 #2', 'wire list #2']]);
    expect(s.dirtyMarks()).toBe(1);
  });

  it('reports an existing wire as created: false without sending a command', async () => {
    const s = scriptedSession({
      'device list': [{ output: DEVICES }],
      'wire list #2': [{ output: COMBINER_WIRED }],
    });
    expect((await editor(s).connect({ device: '#1' }, { device: '#2' })).created).toBe(false);
    expect(s.batches).toEqual([['device list'], ['wire list #2']]);
    expect(s.dirtyMarks()).toBe(0);
  });

  it('sends explicit ports as #<id>.<port> (raw/p2c-edits.txt l.108-117, spec fact 34)', async () => {
    const s = scriptedSession({
      'device list': [{ output: P2C_DEVICES }],
      'wire list #2': [{ output: P2C_COMBINER_FROM_GRAD_A }, { output: P2C_COMBINER_BOTH }],
      'wire connect #1.1 #2.2': [{ output: ["Connected '#1' [1] -> '#2' [2]"] }],
    });
    expect(await editor(s).connect({ device: '#1', port: 1 }, { device: '#2', port: 2 })).toEqual({
      source: GRADIENT_1,
      destination: { ...COMBINER_1, port: 2 },
      created: true,
    });
  });

  it("reports World Machine's error for a source port that does not exist (l.123-124)", async () => {
    const s = scriptedSession({
      'device list': [{ output: P2C_DEVICES }],
      // raw/p2c-edits.txt l.130-135 and l.142-147.
      'wire list #2': [{ output: P2C_COMBINER_FROM_GRAD_A }, { output: P2C_COMBINER_FROM_GRAD_A }],
      'wire connect #1.3 #2.2': [{ errors: ["Error: Error: Output port not found on '#1'"] }],
    });
    await expect(
      editor(s).connect({ device: '#1', port: 3 }, { device: '#2', port: 2 }),
    ).rejects.toMatchObject({
      code: 'WM_COMMAND_FAILED',
      worldMachineMessage: "Error: Error: Output port not found on '#1'",
    });
    expect(s.dirtyMarks()).toBe(0);
  });

  it('refuses an input port the destination does not have', async () => {
    const s = scriptedSession({
      'device list': [{ output: DEVICES }],
      'wire list #2': [{ output: COMBINER_FREE }],
    });
    await expect(editor(s).connect({ device: '#1' }, { device: '#2', port: 3 })).rejects.toMatchObject({
      code: 'REFUSED',
      message: "#2 'Combiner' has no input port 3; its input ports are: 1 (Primary Input), 2 (Primary Input)",
    });
    expect(s.batches).toEqual([['device list'], ['wire list #2']]);
  });

  // Assumed: constructed from the row format of raw/p2b-kind-markers.txt l.112-113 (two devices of one name,
  // spec fact 30) with small ids; no capture lists exactly these devices.
  const SHARED_DEVICES = [
    'Devices (3 total):',
    '  #1     Gradient                ',
    '  #2     Gradient                ',
    '  #3     Combiner                ',
  ];
  const combiner = (input1: string) => [
    "Connections for '#3':",
    '  Inputs:',
    `    [1] Primary Input <- ${input1}`,
    '    [2] Primary Input <- (none)',
    '  Outputs:',
    '    [1] Primary Output -> (none)',
  ];

  it('refuses, sending nothing, when the source name is shared and the input is already wired from that name', async () => {
    const s = scriptedSession({
      'device list': [{ output: SHARED_DEVICES }],
      // Assumed: constructed from raw/p2b-graph-edits.txt l.26-31 for #3.
      'wire list #3': [{ output: combiner("'Gradient' [1]") }],
    });
    await expect(editor(s).connect({ device: '#1' }, { device: '#3' })).rejects.toMatchObject({
      code: 'REFUSED',
      message:
        "Several devices are named 'Gradient', and wire list names devices, so it cannot tell whether this input is already wired from #1; rename one of them first",
    });
    expect(s.batches).toEqual([['device list'], ['wire list #3']]);
    expect(s.dirtyMarks()).toBe(0);
  });

  it("reports World Machine's refusal when the source name is shared and the input is wired from another device", async () => {
    const s = scriptedSession({
      'device list': [{ output: SHARED_DEVICES }],
      // Assumed: constructed from raw/p2b-graph-edits.txt l.26-31 for #3, with the input wired from 'Other'.
      'wire list #3': [{ output: combiner("'Other' [1]") }, { output: combiner("'Other' [1]") }],
      // raw/v4-quoting.txt l.127-128 (spec fact 34), with the ids of this scenario.
      'wire connect #1 #3': [
        { errors: ["Error: Error: Input '#3' is already connected. Disconnect first."] },
      ],
    });
    await expect(editor(s).connect({ device: '#1' }, { device: '#3' })).rejects.toMatchObject({
      code: 'WM_COMMAND_FAILED',
      worldMachineMessage: "Error: Error: Input '#3' is already connected. Disconnect first.",
    });
    expect(s.batches).toEqual([['device list'], ['wire list #3'], ['wire connect #1 #3', 'wire list #3']]);
    expect(s.dirtyMarks()).toBe(0);
  });

  it('connects when the source name is shared but the input is free of that name', async () => {
    const s = scriptedSession({
      'device list': [{ output: SHARED_DEVICES }],
      // Assumed: constructed from raw/p2b-graph-edits.txt l.121-126 and l.26-31 for #3.
      'wire list #3': [{ output: combiner('(none)') }, { output: combiner("'Gradient' [1]") }],
      // raw/p2b-graph-edits.txt l.22-23, with the ids of this scenario.
      'wire connect #1 #3': [{ output: ["Connected '#1' [1] -> '#3' [1]"] }],
    });
    expect((await editor(s).connect({ device: '#1' }, { device: '#3' })).created).toBe(true);
    expect(s.batches).toEqual([['device list'], ['wire list #3'], ['wire connect #1 #3', 'wire list #3']]);
    expect(s.dirtyMarks()).toBe(1);
  });

  it("reports World Machine's refusal for an input that is already connected", async () => {
    const s = scriptedSession({
      // raw/v4-quoting.txt l.97-103.
      'device list': [
        {
          output: [
            'Devices (6 total):',
            '  #1     Grad A                   (Gradient)',
            '  #2     Grad B                   (Gradient)',
            '  #3     Grad C                   (Gradient)',
            '  #4     GradById                 (Gradient)',
            '  #5     Combiner                ',
            '  #6     Gradient                ',
          ],
        },
      ],
      // Before and after the refused connect: raw/v4-quoting.txt l.118-124 and l.130-137, verbatim. The capture
      // listed by name (`wire list Combiner`), so the header names Combiner; the ids are the capture's (#5 is
      // Combiner) and need no adjustment, and the parser does not read the header's name.
      'wire list #5': [{ output: V4_COMBINER_WIRED }, { output: V4_COMBINER_WIRED }],
      // raw/v4-quoting.txt l.127-128.
      'wire connect #4 #5': [
        { errors: ["Error: Error: Input '#5' is already connected. Disconnect first."] },
      ],
    });
    await expect(editor(s).connect({ device: 'GradById' }, { device: '#5' })).rejects.toMatchObject({
      code: 'WM_COMMAND_FAILED',
      worldMachineMessage: "Error: Error: Input '#5' is already connected. Disconnect first.",
    });
    expect(s.batches).toEqual([['device list'], ['wire list #5'], ['wire connect #4 #5', 'wire list #5']]);
    expect(s.dirtyMarks()).toBe(0);
  });

  it('refuses a device the project does not list', async () => {
    const s = scriptedSession({ 'device list': [{ output: DEVICES }] });
    await expect(editor(s).connect({ device: 'Nope' }, { device: '#2' })).rejects.toMatchObject({
      code: 'REFUSED',
    });
    expect(s.batches).toEqual([['device list']]);
  });
});

describe('WorldMachineWireEditor.connect read-back checks', () => {
  it('reports a missing Connected line as UNEXPECTED_OUTPUT, with the project marked modified', async () => {
    const s = scriptedSession({
      'device list': [{ output: DEVICES }],
      'wire list #2': [{ output: COMBINER_FREE }, { output: COMBINER_WIRED }],
      // Assumed: a reply without the confirmation line; no capture shows one.
      'wire connect #1 #2': [{ output: [] }],
    });
    await expect(editor(s).connect({ device: '#1' }, { device: '#2' })).rejects.toMatchObject({
      code: 'UNEXPECTED_OUTPUT',
    });
    expect(s.batches).toEqual([['device list'], ['wire list #2'], ['wire connect #1 #2', 'wire list #2']]);
    expect(s.dirtyMarks()).toBe(1);
  });

  it('reports a confirmed wire that the read-back does not show as WM_COMMAND_FAILED', async () => {
    const s = scriptedSession({
      'device list': [{ output: DEVICES }],
      // Assumed: a connect without effect, so the second list still shows no wire; no capture shows one.
      'wire list #2': [{ output: COMBINER_FREE }, { output: COMBINER_FREE }],
      // raw/p2b-graph-edits.txt l.22-23.
      'wire connect #1 #2': [{ output: ["Connected '#1' [1] -> '#2' [1]"] }],
    });
    await expect(editor(s).connect({ device: '#1' }, { device: '#2' })).rejects.toMatchObject({
      code: 'WM_COMMAND_FAILED',
      message: 'World Machine confirmed the wire, but wire list of #2 does not show it',
    });
    expect(s.batches).toEqual([['device list'], ['wire list #2'], ['wire connect #1 #2', 'wire list #2']]);
    expect(s.dirtyMarks()).toBe(1);
  });
});

describe('WorldMachineWireEditor.disconnect', () => {
  it('disconnects an existing wire, checks wire list afterwards, and marks the project modified', async () => {
    const s = scriptedSession({
      'device list': [{ output: DEVICES }],
      'wire list #2': [{ output: COMBINER_WIRED }, { output: COMBINER_FREE }],
      // raw/p2b-graph-edits.txt l.117-118.
      'wire disconnect #1 #2': [{ output: ["Disconnected '#1' [1] -> '#2' [1]"] }],
    });
    expect(await editor(s).disconnect({ device: 'Gradient' }, { device: 'Combiner' })).toEqual({
      source: GRADIENT_1,
      destination: COMBINER_1,
      removed: true,
    });
    expect(s.batches).toEqual([['device list'], ['wire list #2'], ['wire disconnect #1 #2', 'wire list #2']]);
    expect(s.dirtyMarks()).toBe(1);
  });

  it('returns removed: false and sends nothing when the wire is absent (spec section 7, fact 26)', async () => {
    const s = scriptedSession({
      'device list': [{ output: DEVICES }],
      'wire list #2': [{ output: COMBINER_FREE }],
    });
    expect((await editor(s).disconnect({ device: '#1' }, { device: '#2' })).removed).toBe(false);
    expect(s.batches).toEqual([['device list'], ['wire list #2']]);
    expect(s.dirtyMarks()).toBe(0);
  });

  it('reports a wire still present afterwards as WM_COMMAND_FAILED', async () => {
    const s = scriptedSession({
      'device list': [{ output: DEVICES }],
      // Assumed: a disconnect without effect, so the second list still shows the wire; no capture shows one.
      'wire list #2': [{ output: COMBINER_WIRED }, { output: COMBINER_WIRED }],
      // raw/p2b-graph-edits.txt l.117-118.
      'wire disconnect #1 #2': [{ output: ["Disconnected '#1' [1] -> '#2' [1]"] }],
    });
    await expect(editor(s).disconnect({ device: '#1' }, { device: '#2' })).rejects.toMatchObject({
      code: 'WM_COMMAND_FAILED',
      message: 'World Machine reported the disconnection, but wire list of #2 still shows the wire',
    });
    expect(s.dirtyMarks()).toBe(0);
  });

  it('refuses to disconnect when several devices share the source name', async () => {
    const s = scriptedSession({
      // Assumed: constructed from the row format of raw/p2b-kind-markers.txt l.112-113 (two devices of one name,
      // spec fact 30) with small ids; no capture lists exactly these devices.
      'device list': [
        {
          output: [
            'Devices (3 total):',
            '  #1     Gradient                ',
            '  #2     Gradient                ',
            '  #3     Combiner                ',
          ],
        },
      ],
      // Assumed: constructed from raw/p2b-graph-edits.txt l.26-31 for #3.
      'wire list #3': [
        {
          output: [
            "Connections for '#3':",
            '  Inputs:',
            "    [1] Primary Input <- 'Gradient' [1]",
            '    [2] Primary Input <- (none)',
            '  Outputs:',
            '    [1] Primary Output -> (none)',
          ],
        },
      ],
    });
    await expect(editor(s).disconnect({ device: '#1' }, { device: '#3' })).rejects.toMatchObject({
      code: 'REFUSED',
      message: expect.stringContaining("Several devices are named 'Gradient'"),
    });
    expect(s.batches).toEqual([['device list'], ['wire list #3']]);
  });

  it('disconnects a wire from a renamed source (spec fact 34)', async () => {
    const s = scriptedSession({
      'device list': [{ output: P2C_DEVICES }],
      // raw/p2c-edits.txt l.90-95 (wire from 'Grad A') and l.154-159 (no wires).
      'wire list #2': [{ output: P2C_COMBINER_FROM_GRAD_A }, { output: P2C_COMBINER_FREE }],
      // Assumed: the echo form of raw/p2c-edits.txt l.120-121 (spec fact 26) with #4 and port 1; no capture shows it.
      'wire disconnect #4 #2': [{ output: ["Disconnected '#4' [1] -> '#2' [1]"] }],
    });
    expect(await editor(s).disconnect({ device: 'Grad A' }, { device: '#2' })).toEqual({
      source: { id: 4, name: 'Grad A', port: 1 },
      destination: COMBINER_1,
      removed: true,
    });
    expect(s.dirtyMarks()).toBe(1);
  });

  it('matches a 23-character listed name by prefix against a longer wire-list name (spec fact 33, ruling K4)', async () => {
    const s = scriptedSession({
      // Assumed: constructed from the row form of raw/p2c-edits.txt l.58 (a 24-character name listed as its first 23
      // characters); no capture lists exactly these devices.
      'device list': [
        {
          output: [
            'Devices (2 total):',
            '  #1     ABCDEFGHIJKLMNOPQRSTUVW  (Gradient)',
            '  #2     Combiner                ',
          ],
        },
      ],
      'wire list #2': [
        {
          output: [
            "Connections for '#2':",
            '  Inputs:',
            // Assumed: wire list prints the whole name; prefix matching also covers a truncated one.
            "    [1] Primary Input <- 'ABCDEFGHIJKLMNOPQRSTUVWX' [1]",
            '    [2] Primary Input <- (none)',
            '  Outputs:',
            '    [1] Primary Output -> (none)',
          ],
        },
        { output: P2C_COMBINER_FREE },
      ],
      // raw/p2b-graph-edits.txt l.117-118.
      'wire disconnect #1 #2': [{ output: ["Disconnected '#1' [1] -> '#2' [1]"] }],
    });
    expect((await editor(s).disconnect({ device: '#1' }, { device: '#2' })).removed).toBe(true);
  });

  it('treats two devices listed with one 23-character name as sharing it (ruling K4)', async () => {
    const s = scriptedSession({
      // Assumed: constructed from the row form of raw/p2c-edits.txt l.58; no capture lists exactly these devices.
      'device list': [
        {
          output: [
            'Devices (3 total):',
            '  #1     ABCDEFGHIJKLMNOPQRSTUVW  (Gradient)',
            '  #2     Combiner                ',
            '  #3     ABCDEFGHIJKLMNOPQRSTUVW  (Gradient)',
          ],
        },
      ],
      // Assumed: wire list prints the whole name, as in the test above.
      'wire list #2': [
        {
          output: [
            "Connections for '#2':",
            '  Inputs:',
            "    [1] Primary Input <- 'ABCDEFGHIJKLMNOPQRSTUVWX' [1]",
            '    [2] Primary Input <- (none)',
            '  Outputs:',
            '    [1] Primary Output -> (none)',
          ],
        },
      ],
    });
    await expect(editor(s).disconnect({ device: '#1' }, { device: '#2' })).rejects.toMatchObject({
      code: 'REFUSED',
      message: expect.stringContaining("Several devices are named 'ABCDEFGHIJKLMNOPQRSTUVW'"),
    });
    expect(s.batches).toEqual([['device list'], ['wire list #2']]);
  });

  it("matches a listed name whose 23rd character is a space against the full wire-list name (ruling K4')", async () => {
    const s = scriptedSession({
      // Assumed: row form of raw/p2c-edits.txt l.58 for a 24-character name 'Mountain Ridge Erosion 2' whose 23rd
      // character is a space, so the 23 listed characters trim to 'Mountain Ridge Erosion'; no capture lists it.
      'device list': [
        {
          output: [
            'Devices (2 total):',
            '  #1     Mountain Ridge Erosion   (Gradient)',
            '  #2     Combiner                ',
          ],
        },
      ],
      'wire list #2': [
        {
          output: [
            "Connections for '#2':",
            '  Inputs:',
            // Assumed: wire list prints the whole name.
            "    [1] Primary Input <- 'Mountain Ridge Erosion 2' [1]",
            '    [2] Primary Input <- (none)',
            '  Outputs:',
            '    [1] Primary Output -> (none)',
          ],
        },
        { output: P2C_COMBINER_FREE },
      ],
      // raw/p2b-graph-edits.txt l.117-118.
      'wire disconnect #1 #2': [{ output: ["Disconnected '#1' [1] -> '#2' [1]"] }],
    });
    expect((await editor(s).disconnect({ device: '#1' }, { device: '#2' })).removed).toBe(true);
    expect(s.batches).toEqual([['device list'], ['wire list #2'], ['wire disconnect #1 #2', 'wire list #2']]);
    expect(s.dirtyMarks()).toBe(1);
  });

  it('reports a missing Disconnected line as UNEXPECTED_OUTPUT; the read-back decides the dirty mark', async () => {
    const s = scriptedSession({
      'device list': [{ output: DEVICES }],
      'wire list #2': [{ output: COMBINER_WIRED }, { output: COMBINER_FREE }],
      // Assumed: a reply without the confirmation line; no capture shows one.
      'wire disconnect #1 #2': [{ output: [] }],
    });
    await expect(editor(s).disconnect({ device: '#1' }, { device: '#2' })).rejects.toMatchObject({
      code: 'UNEXPECTED_OUTPUT',
    });
    expect(s.batches).toEqual([['device list'], ['wire list #2'], ['wire disconnect #1 #2', 'wire list #2']]);
    expect(s.dirtyMarks()).toBe(1);
  });

  it('marks the project modified and rethrows when the wire list after the disconnect fails (ruling C2)', async () => {
    const s = scriptedSession({
      'device list': [{ output: DEVICES }],
      // Assumed: the second wire list answers with an error; no capture shows one.
      'wire list #2': [{ output: COMBINER_WIRED }, { errors: ["Error: Error: Device '#2' not found"] }],
      // raw/p2b-graph-edits.txt l.117-118.
      'wire disconnect #1 #2': [{ output: ["Disconnected '#1' [1] -> '#2' [1]"] }],
    });
    await expect(editor(s).disconnect({ device: '#1' }, { device: '#2' })).rejects.toMatchObject({
      code: 'WM_COMMAND_FAILED',
    });
    expect(s.batches).toEqual([['device list'], ['wire list #2'], ['wire disconnect #1 #2', 'wire list #2']]);
    expect(s.dirtyMarks()).toBe(1);
  });
});
