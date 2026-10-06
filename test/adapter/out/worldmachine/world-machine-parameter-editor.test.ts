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
      Width: '1.5 km',
      Direction: 3.5,
      Tiling: 'Clamp',
      Nope: 1,
    });
    await expect(call).rejects.toMatchObject({
      code: 'REFUSED',
      message:
        "Nothing was set on #1 'Gradient': " +
        "'Width': expected a plain decimal number in World Machine's internal units (no units, no decimal comma, no exponent); " +
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
});
