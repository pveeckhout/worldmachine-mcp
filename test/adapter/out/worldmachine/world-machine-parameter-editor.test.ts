import { describe, expect, it } from 'vitest';
import { WorldMachineParameterEditor } from '../../../../src/adapter/out/worldmachine/world-machine-parameter-editor.js';
import { scriptedSession } from '../../../support/scripted-session.js';

// raw/v6b-param-set.txt l.26-29.
const DEVICES = [
  'Devices (3 total):',
  '  #1     Gradient                ',
  '  #2     Height Output           ',
  '  #3     Combiner                ',
];
// raw/p2a-edge-cases.txt l.60-63 (`param list #1` prints the name in its header).
const GRADIENT_PARAMS = [
  "Parameters for 'Gradient' (Gradient):",
  '  Direction                 int       0',
  '  Width                     float     8 km',
  '  Tiling                    enum      Clamp',
];
// raw/v6b-param-set.txt l.39-44.
const HEIGHT_OUTPUT_PARAMS = [
  "Parameters for 'Height Output' (Height Output):",
  '  filename                  filename  <project>_<name>_<res>.png',
  '  format                    enum      PNG (16bit)',
  '  exportAlways              bool      false',
  '  tiled                     bool      true',
  '  writeButton               action    ',
];
// raw/float-scale.txt l.759-762.
const COMBINER_PARAMS = [
  "Parameters for 'Combiner' (Combiner):",
  '  Method                    enum      Average',
  '  Strength                  float     0.5',
];
// raw/float-scale.txt l.4318, l.4333, and l.4336 (rows abridged).
const RIVER_DEVICES = ['Devices (1 total):', '  #536   River                   '];
const RIVER_LENGTHS = [
  "Parameters for 'River' (River):",
  '  Bankfull Depth            float     2 m',
  '  Bankfull Width            float     10 m',
];

const editor = (s: ReturnType<typeof scriptedSession>) => new WorldMachineParameterEditor(s.session);

describe('WorldMachineParameterEditor', () => {
  it('sets and reads back each item in one batch, by id, in the order given', async () => {
    const s = scriptedSession({
      'device list': [{ output: DEVICES }],
      'param list #1': [{ output: GRADIENT_PARAMS }],
      // raw/v6b-param-set.txt l.111-115, 84-88, 171-175.
      'param set #1.Direction 3': [{ output: ['Set #1.Direction = 3'] }],
      'param get #1.Direction': [{ output: ['#1.Direction = 3'] }],
      'param set #1.Width 0.5': [{ output: ['Set #1.Width = 0.5'] }],
      'param get #1.Width': [{ output: ['#1.Width = 4 km'] }],
      'param set #1.Tiling 1': [{ output: ['Set #1.Tiling = 1'] }],
      'param get #1.Tiling': [{ output: ['#1.Tiling = Mirrored Repeat'] }],
    });
    expect(await editor(s).updateParameters('gradient', { Direction: 3, Width: 0.5, Tiling: '1' })).toEqual({
      device: { id: 1, name: 'Gradient' },
      parameters: [
        { name: 'Direction', type: 'int', requested: '3', outcome: 'applied', value: '3' },
        { name: 'Width', type: 'float', requested: '0.5', outcome: 'applied', value: '4 km' },
        { name: 'Tiling', type: 'enum', requested: '1', outcome: 'applied', value: 'Mirrored Repeat' },
      ],
    });
    expect(s.batches).toEqual([
      ['device list'],
      ['param list #1'],
      [
        'param set #1.Direction 3',
        'param get #1.Direction',
        'param set #1.Width 0.5',
        'param get #1.Width',
        'param set #1.Tiling 1',
        'param get #1.Tiling',
      ],
    ]);
    expect(s.dirtyMarks()).toBe(1);
  });

  it('sends a boolean as captured', async () => {
    const s = scriptedSession({
      'device list': [{ output: DEVICES }],
      'param list #2': [{ output: HEIGHT_OUTPUT_PARAMS }],
      // raw/v6b-param-set.txt l.126-130, adapted from exportAlways, which is refused (spec v2a section 6), to tiled.
      'param set #2.tiled true': [{ output: ['Set #2.tiled = true'] }],
      'param get #2.tiled': [{ output: ['#2.tiled = true'] }],
    });
    const update = await editor(s).updateParameters('#2', { tiled: true });
    expect(update.parameters.map((item) => [item.outcome, item.value])).toEqual([['applied', 'true']]);
  });

  it('refuses the whole call before sending when any item is invalid', async () => {
    const s = scriptedSession({
      'device list': [{ output: DEVICES }],
      'param list #1': [{ output: GRADIENT_PARAMS }],
    });
    const call = editor(s).updateParameters('#1', {
      Width: '1.5 ft',
      Direction: 3.5,
      Tiling: 'Clamp',
      Nope: 1,
    });
    await expect(call).rejects.toMatchObject({
      code: 'REFUSED',
      message:
        "Nothing was set on #1 'Gradient': " +
        "'Width': expected a plain decimal number in World Machine's internal units, or a length in m or km such as \"500 m\"; " +
        "'Direction': expected an integer without a decimal point; " +
        "'Tiling': expected the 0-based index of an option, such as 0 or 1; " +
        "'Nope': no such parameter. Its parameters: Direction (int), Width (float), Tiling (enum)",
    });
    expect(s.batches).toEqual([['device list'], ['param list #1']]);
    expect(s.dirtyMarks()).toBe(0);
  });

  it('refuses action, filename, and exportAlways parameters without sending edits (spec facts 36, section 9, v2a section 6)', async () => {
    const s = scriptedSession({
      'device list': [{ output: DEVICES }],
      'param list #2': [{ output: HEIGHT_OUTPUT_PARAMS }],
    });
    await expect(
      editor(s).updateParameters('#2', { writeButton: '1', filename: '/w/out.png', exportAlways: true }),
    ).rejects.toMatchObject({
      code: 'REFUSED',
      message: expect.stringContaining(
        "'writeButton': action parameters are buttons and cannot be set; " +
          "'filename': filename parameters set where World Machine writes output and cannot be set; " +
          "'exportAlways': exportAlways makes World Machine write output on every full build and cannot be set",
      ),
    });
    expect(s.batches).toEqual([['device list'], ['param list #2']]);
    expect(s.dirtyMarks()).toBe(0);
  });

  it('reports a rejected item before an applied one, each with its own read-back', async () => {
    const s = scriptedSession({
      'device list': [{ output: DEVICES }],
      'param list #1': [{ output: GRADIENT_PARAMS }],
      // raw/p2c-edits.txt l.218-222 (spec fact 35).
      'param set #1.Tiling 99': [{ errors: ['Error: Error: Enum index out of range (0-2): 99'] }],
      'param get #1.Tiling': [{ output: ['#1.Tiling = Clamp'] }],
      // raw/v6b-param-set.txt l.111-115, adapted (the capture's value differs; Assumed for this order).
      'param set #1.Direction 3': [{ output: ['Set #1.Direction = 3'] }],
      'param get #1.Direction': [{ output: ['#1.Direction = 3'] }],
    });
    const update = await editor(s).updateParameters('#1', { Tiling: 99, Direction: 3 });
    expect(update.parameters).toEqual([
      {
        name: 'Tiling',
        type: 'enum',
        requested: '99',
        outcome: 'rejected',
        value: 'Clamp',
        worldMachineMessage: 'Error: Error: Enum index out of range (0-2): 99',
      },
      { name: 'Direction', type: 'int', requested: '3', outcome: 'applied', value: '3' },
    ]);
    expect(s.dirtyMarks()).toBe(1);
  });

  it('leaves dirty alone when World Machine rejects every item', async () => {
    const s = scriptedSession({
      'device list': [{ output: DEVICES }],
      'param list #1': [{ output: GRADIENT_PARAMS }],
      // raw/p2c-edits.txt l.218-222, as above.
      'param set #1.Tiling 99': [{ errors: ['Error: Error: Enum index out of range (0-2): 99'] }],
      'param get #1.Tiling': [{ output: ['#1.Tiling = Clamp'] }],
    });
    expect((await editor(s).updateParameters('#1', { Tiling: 99 })).parameters[0]?.outcome).toBe('rejected');
    expect(s.dirtyMarks()).toBe(0);
  });

  it('points to undo when a read-back fails after a value was set', async () => {
    const s = scriptedSession({
      'device list': [{ output: DEVICES }],
      'param list #1': [{ output: GRADIENT_PARAMS }],
      'param set #1.Direction 3': [{ output: ['Set #1.Direction = 3'] }],
      // Assumed: a `param get` without its line; no capture shows one.
      'param get #1.Direction': [{ output: [] }],
    });
    await expect(editor(s).updateParameters('#1', { Direction: 3 })).rejects.toMatchObject({
      code: 'UNEXPECTED_OUTPUT',
      message: expect.stringContaining('revert with undo'),
    });
    expect(s.dirtyMarks()).toBe(1);
  });

  it('drops licence and log lines from a rejected item (spec section 8)', async () => {
    const s = scriptedSession({
      'device list': [{ output: DEVICES }],
      'param list #1': [{ output: GRADIENT_PARAMS }],
      // raw/p2c-edits.txt l.218-219, plus two lines constructed to exercise the filter: no capture shows them here.
      'param set #1.Tiling 99': [
        {
          errors: [
            'Error: Error: Enum index out of range (0-2): 99',
            'Error: License Manager: seat check failed',
            '[Info       ] Closing current project',
          ],
        },
      ],
      'param get #1.Tiling': [{ output: ['#1.Tiling = Clamp'] }],
    });
    const [item] = (await editor(s).updateParameters('#1', { Tiling: 99 })).parameters;
    expect(item?.worldMachineMessage).toBe('Error: Error: Enum index out of range (0-2): 99');
  });

  it('omits worldMachineMessage when only licence lines remain', async () => {
    const s = scriptedSession({
      'device list': [{ output: DEVICES }],
      'param list #1': [{ output: GRADIENT_PARAMS }],
      // Constructed to exercise the filter.
      'param set #1.Tiling 99': [{ errors: ['Error: licence seat lost'] }],
      'param get #1.Tiling': [{ output: ['#1.Tiling = Clamp'] }],
    });
    const [item] = (await editor(s).updateParameters('#1', { Tiling: 99 })).parameters;
    expect(item).toEqual({
      name: 'Tiling',
      type: 'enum',
      requested: '99',
      outcome: 'rejected',
      value: 'Clamp',
    });
  });

  it('refuses an empty call and an unlisted device without sending edits', async () => {
    const empty = scriptedSession({});
    await expect(editor(empty).updateParameters('#1', {})).rejects.toMatchObject({ code: 'REFUSED' });
    expect(empty.batches).toEqual([]);
    const unlisted = scriptedSession({ 'device list': [{ output: DEVICES }] });
    await expect(editor(unlisted).updateParameters('Nope', { Direction: 1 })).rejects.toMatchObject({
      code: 'REFUSED',
    });
    expect(unlisted.batches).toEqual([['device list']]);
  });

  it('quotes the reference of a parameter whose name has a space when setting it, not when reading it', async () => {
    const s = scriptedSession({
      'device list': [{ output: ['Devices (1 total):', '  #536   River                   '] }],
      // raw/river-device.txt l.31-56 (rows abridged).
      'param list #536': [
        {
          output: [
            "Parameters for 'River' (River):",
            '  Sinuosity                 float     0.0',
            '  Planform Type             enum      Simple Alignment',
            '  Bankfull Width            float     10 m',
          ],
        },
      ],
      // raw/river-device.txt: an unquoted reference is split at the first space; a quoted one is set whole, and
      // `param get` reads the rest of the line and prints the reference without quotes.
      'param set "#536.Planform Type" 1': [{ output: ['Set #536.Planform Type = 1'] }],
      'param get #536.Planform Type': [{ output: ['#536.Planform Type = Layout Alignment'] }],
      'param set "#536.Bankfull Width" 25': [{ output: ['Set #536.Bankfull Width = 25'] }],
      'param get #536.Bankfull Width': [{ output: ['#536.Bankfull Width = 25 m'] }],
    });
    const update = await editor(s).updateParameters('River', { 'Planform Type': '1', 'Bankfull Width': 25 });
    expect(update.parameters.map((item) => [item.name, item.outcome, item.value])).toEqual([
      ['Planform Type', 'applied', 'Layout Alignment'],
      ['Bankfull Width', 'applied', '25 m'],
    ]);
    expect(s.batches.at(-1)).toEqual([
      'param set "#536.Planform Type" 1',
      'param get #536.Planform Type',
      'param set "#536.Bankfull Width" 25',
      'param get #536.Bankfull Width',
    ]);
  });

  it('refuses a unit on a float that shows no m or km, and on an enum, before sending (float-units section 3)', async () => {
    const s = scriptedSession({
      'device list': [{ output: DEVICES }],
      'param list #3': [{ output: COMBINER_PARAMS }],
    });
    await expect(editor(s).updateParameters('#3', { Strength: '1 m', Method: '1 km' })).rejects.toMatchObject(
      {
        code: 'REFUSED',
        message:
          "Nothing was set on #3 'Combiner': " +
          "'Strength': a unit is accepted only on a float that shows m or km; " +
          "'Method': expected the 0-based index of an option, such as 0 or 1. " +
          'Its parameters: Method (enum), Strength (float)',
      },
    );
    expect(s.batches).toEqual([['device list'], ['param list #3']]);
  });

  it('reads the scale, undoes the probe, and sends the converted value before the plain items (section 4)', async () => {
    const s = scriptedSession({
      'device list': [{ output: DEVICES }],
      'param list #1': [{ output: GRADIENT_PARAMS }],
      // raw/float-scale-default.txt l.63-67 and raw/float-scale-undo.txt l.66-70 (fact 90).
      'param set #1.Width 1': [{ output: ['Set #1.Width = 1'] }],
      'param get #1.Width': [
        { output: ['#1.Width = 8 km'] },
        { output: ['#1.Width = 8 km'] },
        { output: ['#1.Width = 500 m'] },
      ],
      'project undo': [{ output: ['Undo performed.'] }],
      'param set #1.Width 0.0625': [{ output: ['Set #1.Width = 0.0625'] }],
      'param set #1.Direction 3': [{ output: ['Set #1.Direction = 3'] }],
      'param get #1.Direction': [{ output: ['#1.Direction = 3'] }],
    });
    expect(await editor(s).updateParameters('#1', { Width: '500 m', Direction: 3 })).toEqual({
      device: { id: 1, name: 'Gradient' },
      parameters: [
        {
          name: 'Width',
          type: 'float',
          requested: '0.0625',
          outcome: 'applied',
          value: '500 m',
          given: '500 m',
          scale: '8 km',
        },
        { name: 'Direction', type: 'int', requested: '3', outcome: 'applied', value: '3' },
      ],
    });
    expect(s.batches).toEqual([
      ['device list'],
      ['param list #1'],
      ['param set #1.Width 1'],
      ['param get #1.Width', 'project undo', 'param get #1.Width'],
      [
        'param set #1.Width 0.0625',
        'param get #1.Width',
        'param set #1.Direction 3',
        'param get #1.Direction',
      ],
    ]);
    // Section 4: the probe marks the project unsaved, and so does the applied batch.
    expect(s.dirtyMarks()).toBe(2);
  });

  it('probes several length items in call order, then sends one batch', async () => {
    const s = scriptedSession({
      'device list': [{ output: RIVER_DEVICES }],
      'param list #536': [{ output: RIVER_LENGTHS }],
      // raw/float-scale.txt l.4385-4389 and l.4439-4443: both read 8 km at 1.
      'param set "#536.Bankfull Depth" 1': [{ output: ['Set #536.Bankfull Depth = 1'] }],
      'param set "#536.Bankfull Width" 1': [{ output: ['Set #536.Bankfull Width = 1'] }],
      'param get #536.Bankfull Depth': [
        { output: ['#536.Bankfull Depth = 8 km'] },
        { output: ['#536.Bankfull Depth = 2 m'] },
        { output: ['#536.Bankfull Depth = 1 m'] },
      ],
      'param get #536.Bankfull Width': [
        { output: ['#536.Bankfull Width = 8 km'] },
        { output: ['#536.Bankfull Width = 10 m'] },
        { output: ['#536.Bankfull Width = 20 m'] },
      ],
      'project undo': [{ output: ['Undo performed.'] }, { output: ['Undo performed.'] }],
      'param set "#536.Bankfull Depth" 0.000125': [{ output: ['Set #536.Bankfull Depth = 0.000125'] }],
      'param set "#536.Bankfull Width" 0.0025': [{ output: ['Set #536.Bankfull Width = 0.0025'] }],
    });
    const update = await editor(s).updateParameters('#536', {
      'Bankfull Depth': '1 m',
      'Bankfull Width': '20m',
    });
    expect(
      update.parameters.map((item) => [item.name, item.requested, item.value, item.given, item.scale]),
    ).toEqual([
      ['Bankfull Depth', '0.000125', '1 m', '1 m', '8 km'],
      ['Bankfull Width', '0.0025', '20 m', '20m', '8 km'],
    ]);
    expect(s.batches.slice(2)).toEqual([
      ['param set "#536.Bankfull Depth" 1'],
      ['param get #536.Bankfull Depth', 'project undo', 'param get #536.Bankfull Depth'],
      ['param set "#536.Bankfull Width" 1'],
      ['param get #536.Bankfull Width', 'project undo', 'param get #536.Bankfull Width'],
      [
        'param set "#536.Bankfull Depth" 0.000125',
        'param get #536.Bankfull Depth',
        'param set "#536.Bankfull Width" 0.0025',
        'param get #536.Bankfull Width',
      ],
    ]);
    expect(s.dirtyMarks()).toBe(3);
  });

  it('fails without sending an undo when the probe set is neither refused nor confirmed (section 4)', async () => {
    const s = scriptedSession({
      'device list': [{ output: DEVICES }],
      'param list #1': [{ output: GRADIENT_PARAMS }],
      // Assumed: a probe set without `Set #1.Width = 1` (raw/float-scale-undo-same.txt l.55) and without an error;
      // no capture shows one. No `project undo` is scripted, so sending one would also fail the test.
      'param set #1.Width 1': [{ output: [] }],
    });
    await expect(editor(s).updateParameters('#1', { Width: '500 m', Direction: 3 })).rejects.toMatchObject({
      code: 'UNEXPECTED_OUTPUT',
      message:
        "World Machine did not confirm the scale probe of 'Width' on #1 'Gradient': expected 'Set #1.Width = 1'. " +
        'The parameter may be left at 1; check it with get_device and revert with undo. Nothing else was set.',
    });
    expect(s.batches).toEqual([['device list'], ['param list #1'], ['param set #1.Width 1']]);
    expect(s.batches.flat()).not.toContain('project undo');
    expect(s.dirtyMarks()).toBe(1);
  });

  it('fails before setting anything when the undo is not confirmed (section 4)', async () => {
    const s = scriptedSession({
      'device list': [{ output: DEVICES }],
      'param list #1': [{ output: GRADIENT_PARAMS }],
      'param set #1.Width 1': [{ output: ['Set #1.Width = 1'] }],
      'param get #1.Width': [{ output: ['#1.Width = 8 km'] }, { output: ['#1.Width = 8 km'] }],
      // Assumed: an undo without its confirmation line; no capture shows one.
      'project undo': [{ output: [] }],
    });
    await expect(editor(s).updateParameters('#1', { Width: '500 m', Direction: 3 })).rejects.toMatchObject({
      code: 'UNEXPECTED_OUTPUT',
      message:
        "Could not confirm that the scale probe of 'Width' on #1 'Gradient' was undone: expected '8 km', read " +
        "'8 km'. The parameter may be left at 1; check it with get_device and revert with undo. Nothing else was set.",
    });
    expect(s.batches).toHaveLength(4);
    expect(s.dirtyMarks()).toBe(1);
  });

  it('fails before setting anything when the read after the undo fails', async () => {
    const s = scriptedSession({
      'device list': [{ output: DEVICES }],
      'param list #1': [{ output: GRADIENT_PARAMS }],
      'param set #1.Width 1': [{ output: ['Set #1.Width = 1'] }],
      'param get #1.Width': [
        { output: ['#1.Width = 8 km'] },
        // Assumed: a read after the undo that fails, with a neutral error text; no capture shows one, so spec section 6
        // assigns this case to a scripted session.
        { errors: ['Error: Error: Read failed'] },
      ],
      'project undo': [{ output: ['Undo performed.'] }],
    });
    await expect(editor(s).updateParameters('#1', { Width: '500 m' })).rejects.toMatchObject({
      code: 'UNEXPECTED_OUTPUT',
      message: expect.stringContaining("expected '8 km', read 'Error: Error: Read failed'"),
    });
    expect(s.batches).toHaveLength(4);
  });

  it('rejects a length that underflows at the scale read, after the undo (spec section 4, plan decision P9)', async () => {
    // 5e-324 m, the smallest double: in range for validation, but 5e-324 / 8000 is 0.
    const given = `0.${'0'.repeat(323)}5 m`;
    const s = scriptedSession({
      'device list': [{ output: DEVICES }],
      'param list #1': [{ output: GRADIENT_PARAMS }],
      'param set #1.Width 1': [{ output: ['Set #1.Width = 1'] }],
      'param get #1.Width': [{ output: ['#1.Width = 8 km'] }, { output: ['#1.Width = 8 km'] }],
      'project undo': [{ output: ['Undo performed.'] }],
      'param set #1.Direction 3': [{ output: ['Set #1.Direction = 3'] }],
      'param get #1.Direction': [{ output: ['#1.Direction = 3'] }],
    });
    const update = await editor(s).updateParameters('#1', { Width: given, Direction: 3 });
    expect(update.parameters).toEqual([
      {
        name: 'Width',
        type: 'float',
        requested: '1',
        outcome: 'rejected',
        value: '8 km',
        worldMachineMessage: "the length is out of range at a scale of '8 km'",
        given,
        scale: '8 km',
      },
      { name: 'Direction', type: 'int', requested: '3', outcome: 'applied', value: '3' },
    ]);
    expect(s.batches.slice(2)).toEqual([
      ['param set #1.Width 1'],
      ['param get #1.Width', 'project undo', 'param get #1.Width'],
      ['param set #1.Direction 3', 'param get #1.Direction'],
    ]);
  });

  it('probes nothing after a restore that fails, and sets nothing', async () => {
    const s = scriptedSession({
      'device list': [{ output: RIVER_DEVICES }],
      'param list #536': [{ output: RIVER_LENGTHS }],
      'param set "#536.Bankfull Depth" 1': [{ output: ['Set #536.Bankfull Depth = 1'] }],
      'param get #536.Bankfull Depth': [
        { output: ['#536.Bankfull Depth = 8 km'] },
        // Assumed: a read after the undo that differs from the listed `2 m`.
        { output: ['#536.Bankfull Depth = 8 km'] },
      ],
      'project undo': [{ output: ['Undo performed.'] }],
    });
    await expect(
      editor(s).updateParameters('#536', { 'Bankfull Depth': '1 m', 'Bankfull Width': '20 m' }),
    ).rejects.toMatchObject({
      code: 'UNEXPECTED_OUTPUT',
      message: expect.stringContaining(
        "'Bankfull Depth' on #536 'River' was undone: expected '2 m', read '8 km'",
      ),
    });
    expect(s.batches.slice(2)).toEqual([
      ['param set "#536.Bankfull Depth" 1'],
      ['param get #536.Bankfull Depth', 'project undo', 'param get #536.Bankfull Depth'],
    ]);
    expect(s.dirtyMarks()).toBe(1);
  });
});
