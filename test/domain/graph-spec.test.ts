import { describe, expect, it } from 'vitest';
import { WorldMachineError } from '../../src/domain/errors.js';
import { parseSource, type RawGraphSpec, validateGraphSpec } from '../../src/domain/graph-spec.js';

const base = (extra: Partial<RawGraphSpec> = {}): RawGraphSpec => ({
  version: 1,
  devices: [{ name: 'Base', type: 'Advanced Perlin' }],
  ...extra,
});
const device = (name: string) => ({ name, type: 'Gradient' });

function refusal(raw: RawGraphSpec): string {
  try {
    validateGraphSpec(raw);
  } catch (error) {
    if (error instanceof WorldMachineError && error.code === 'REFUSED') return error.message;
    throw error;
  }
  throw new Error('validateGraphSpec accepted the spec');
}

describe('validateGraphSpec (spec v3 section 4)', () => {
  it('normalises a valid spec: inputs by port, sources parsed, remove defaulted', () => {
    expect(
      validateGraphSpec({
        version: 1,
        devices: [
          {
            name: 'Base',
            type: 'Advanced Perlin',
            enabled: true,
            bypassed: true,
            parameters: { octaves: 8, scale: 0.4 },
            inputs: { '4': '#12', '2': null, '1': 'Shape.1', '3': 'My.Device', '5': 'Shape' },
          },
        ],
      }),
    ).toEqual({
      version: 1,
      devices: [
        {
          name: 'Base',
          type: 'Advanced Perlin',
          enabled: true,
          bypassed: true,
          parameters: [
            { name: 'octaves', value: 8 },
            { name: 'scale', value: 0.4 },
          ],
          inputs: [
            { port: 1, source: { device: 'Shape', port: 1 } },
            { port: 2, source: null },
            { port: 3, source: { device: 'My.Device', port: 1 } },
            { port: 4, source: { device: '#12', port: 1 } },
            { port: 5, source: { device: 'Shape', port: 1 } },
          ],
        },
      ],
      remove: [],
    });
  });

  it('accepts 200 entries and a 23-character name', () => {
    const devices = Array.from({ length: 199 }, (_, index) => device(`D${index}`));
    expect(validateGraphSpec({ version: 1, devices, remove: ['Old'] }).devices).toHaveLength(199);
    expect(validateGraphSpec(base({ devices: [device('Twenty-three characters')] })).devices).toHaveLength(1);
  });

  it.each<[string, RawGraphSpec, string]>([
    ['version 2', { ...base(), version: 2 }, 'version must be 1'],
    [
      '201 entries',
      {
        version: 1,
        devices: Array.from({ length: 150 }, (_, i) => device(`D${i}`)),
        remove: Array.from({ length: 51 }, (_, i) => `R${i}`),
      },
      'at most 200',
    ],
    ['an empty name', base({ devices: [device('')] }), 'must not be empty'],
    ['a 24-character name', base({ devices: [device('Twenty-four characters!!')] }), 'longer than 23'],
    ['a leading space', base({ devices: [device(' Base')] }), 'whitespace'],
    ['a trailing space', base({ devices: [device('Base ')] }), 'whitespace'],
    ['a #<n> name', base({ devices: [device('#3')] }), 'device id'],
    ['a marker suffix (D3)', base({ devices: [device('Noise [disabled]')] }), '[disabled]'],
    ['a kind suffix (D3)', base({ devices: [device('Noise  (Perlin)')] }), 'parenthesised'],
    [
      'names equal regardless of case',
      base({ devices: [device('Base'), device('BASE')] }),
      'regardless of case',
    ],
    ['a name in devices and remove', base({ remove: ['base'] }), 'both devices and remove'],
    [
      'an empty remove entry',
      base({ remove: [''] }),
      'A remove entry must be a device name or #<id>, not empty',
    ],
    ['a remove entry twice (D3)', base({ remove: ['Old', 'old'] }), 'twice'],
    ['a 24-character remove entry', base({ remove: ['Twenty-four characters!!'] }), 'longer than'],
    ['a remove entry with a leading space', base({ remove: [' Old'] }), 'whitespace'],
    ['a remove entry with a trailing space', base({ remove: ['Old '] }), 'whitespace'],
    ['port 0', base({ devices: [{ ...device('A'), inputs: { '0': null } }] }), 'input port'],
    ['port x', base({ devices: [{ ...device('A'), inputs: { x: null } }] }), 'input port'],
    ['port 1.5', base({ devices: [{ ...device('A'), inputs: { '1.5': null } }] }), 'input port'],
    [
      'an empty source',
      base({ devices: [{ ...device('A'), inputs: { '1': '' } }] }),
      '\'A\' input 1: source \'\' is not "<device>" or "<device>.<port>"',
    ],
    [
      'a source without a device',
      base({ devices: [{ ...device('A'), inputs: { '1': '.1' } }] }),
      '\'A\' input 1: source \'.1\' is not "<device>" or "<device>.<port>"',
    ],
    [
      'a source with port 0',
      base({ devices: [{ ...device('A'), inputs: { '1': 'Shape.0' } }] }),
      '\'A\' input 1: source \'Shape.0\' is not "<device>" or "<device>.<port>"',
    ],
    [
      'a source with an output port beyond the safe integers',
      base({ devices: [{ ...device('A'), inputs: { '1': 'Src.99999999999999999999' } }] }),
      '\'A\' input 1: source \'Src.99999999999999999999\' is not "<device>" or "<device>.<port>"',
    ],
    [
      'a source with a leading space',
      base({ devices: [{ ...device('A'), inputs: { '1': ' Shape' } }] }),
      '\'A\' input 1: source \' Shape\' is not "<device>" or "<device>.<port>"',
    ],
    [
      'an empty parameter name',
      base({ devices: [{ ...device('A'), parameters: { '': 1 } }] }),
      "'A' parameter '': the name must not be empty",
    ],
    [
      'exportAlways',
      base({ devices: [{ ...device('A'), parameters: { exportAlways: false } }] }),
      "'A' parameter 'exportAlways': cannot be set",
    ],
    [
      'a port beyond the safe integers',
      base({ devices: [{ ...device('A'), inputs: { '99999999999999999999': null } }] }),
      "'A': input port '99999999999999999999' is not a positive whole number",
    ],
    [
      'an exponent number',
      base({ devices: [{ ...device('A'), parameters: { scale: 1e-7 } }] }),
      'plain decimal',
    ],
    ['NaN', base({ devices: [{ ...device('A'), parameters: { scale: Number.NaN } }] }), 'plain decimal'],
    ['id 0 (revision 6)', base({ devices: [{ ...device('A'), id: 0 }] }), 'positive whole number'],
    ['a negative id', base({ devices: [{ ...device('A'), id: -3 }] }), 'positive whole number'],
    ['a fractional id', base({ devices: [{ ...device('A'), id: 1.5 }] }), 'positive whole number'],
    [
      'two entries with one id',
      base({
        devices: [
          { ...device('A'), id: 5 },
          { ...device('B'), id: 5 },
        ],
      }),
      "'A' and 'B' both give id 5",
    ],
    [
      'an id in remove',
      base({ devices: [{ ...device('A'), id: 5 }], remove: ['#5'] }),
      "'#5' in remove is the id of 'A'",
    ],
    [
      'an id in remove with a leading zero (Review Focus 5)',
      base({ devices: [{ ...device('A'), id: 536 }], remove: ['#0536'] }),
      "'#0536' in remove is the id of 'A'",
    ],
    ['a label of the form #<n>', base({ devices: [{ ...device('#3'), id: 3 }] }), 'device id'],
  ])('refuses %s', (_label, raw, fragment) => {
    expect(refusal(raw)).toContain(fragment);
  });
});

describe('parseSource (D9)', () => {
  it.each([
    ['Shape', { device: 'Shape', port: 1 }],
    ['Shape.2', { device: 'Shape', port: 2 }],
    ['Noise.2.3', { device: 'Noise.2', port: 3 }],
    ['#12.2', { device: '#12', port: 2 }],
    ['My.Device', { device: 'My.Device', port: 1 }],
  ])('reads %j', (text, source) => {
    expect(parseSource(text)).toEqual(source);
  });

  it('accepts a #<id> remove entry', () => {
    expect(validateGraphSpec(base({ remove: ['#12'] })).remove).toEqual(['#12']);
  });

  it.each(['', '.1', 'Shape.0', 'Shape.01', ' Shape', 'Shape '])('refuses %j', (text) => {
    expect(parseSource(text)).toBeUndefined();
  });

  it('carries bypassed and leaves it undefined when omitted', () => {
    const spec = validateGraphSpec({
      version: 1,
      devices: [
        { name: 'A', type: 'Gradient', bypassed: false },
        { name: 'B', type: 'Gradient' },
      ],
    });
    expect(spec.devices[0]?.bypassed).toBe(false);
    expect(spec.devices[1]?.bypassed).toBeUndefined();
    expect('bypassed' in (spec.devices[1] ?? {})).toBe(false);
  });

  it('carries an id and leaves it out when omitted (revision 6)', () => {
    const spec = validateGraphSpec({
      version: 1,
      devices: [{ name: 'hills mix', id: 536, type: 'Combiner' }, device('B')],
      remove: ['#537'],
    });
    expect(spec.devices[0]).toEqual({
      name: 'hills mix',
      id: 536,
      type: 'Combiner',
      parameters: [],
      inputs: [],
    });
    expect('id' in (spec.devices[1] ?? {})).toBe(false);
  });
});
