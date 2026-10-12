import { describe, expect, it } from 'vitest';
import type { Parameter } from '../../src/domain/device.js';
import { decimalText, parameterInput, parameterText } from '../../src/domain/parameter-values.js';

const param = (type: string): Parameter => ({ name: 'p', type, value: '' });

describe('decimalText', () => {
  it('writes plain decimals and refuses exponent forms', () => {
    expect(decimalText(0.5)).toBe('0.5');
    expect(decimalText(-2)).toBe('-2');
    expect(decimalText(1e-7)).toBeUndefined();
    expect(decimalText(1e21)).toBeUndefined();
  });
});

describe('parameterText', () => {
  it.each([
    // raw/v6b-param-set.txt l.84-85 and l.90-91: internal values.
    ['float', 0.5, '0.5'],
    ['float', '2', '2'],
    ['float', -0.5, '-0.5'],
    // raw/v6b-param-set.txt l.111-112.
    ['int', 3, '3'],
    // raw/p2c-edits.txt l.182-192 (spec fact 35).
    ['int', '-1', '-1'],
    // raw/v6b-param-set.txt l.126-157: true, false, 1, 0, yes, off (spec fact 18).
    ['bool', true, 'true'],
    ['bool', false, 'false'],
    ['bool', 'yes', 'yes'],
    ['bool', 'off', 'off'],
    ['bool', '1', '1'],
    // raw/v6b-param-set.txt l.165-175: a 0-based index.
    ['enum', 1, '1'],
    ['enum', '0', '0'],
  ])('accepts %s %j as %j', (type, value, text) => {
    expect(parameterText(param(type), value)).toEqual({ text });
  });

  it.each([
    // raw/v6b-param-set.txt l.96-97, 102-103, 117-118, 177-178: World Machine rejects these.
    ['float', '1.5 km'],
    ['float', '1,5'],
    ['int', '3.0'],
    ['int', 3.5],
    ['enum', 'invalid-enum-value'],
    // Accepted by World Machine (spec fact 35, raw/p2c-edits.txt l.194-240) but refused here, so every value sent
    // has one checked form.
    ['enum', 'Clamp'],
    ['float', '1e-1'],
    ['float', '.5'],
    ['float', 1e-7],
    ['bool', 'no'],
    ['bool', 'TRUE'],
    // Not a form of the reported type.
    ['enum', -1],
    ['bool', 1],
    ['float', true],
    // Spec fact 36: World Machine rejects an action and ignores a set on an `other` parameter.
    ['action', '1'],
    ['other', '1'],
    ['filename', '/w/out.png'],
    ['filename', 3],
  ])('refuses %s %j', (type, value) => {
    expect(parameterText(param(type), value)).toHaveProperty('problem');
  });

  it('refuses a filename: it sets where World Machine writes output (spec section 9)', () => {
    expect(parameterText(param('filename'), '/w/out.png')).toEqual({
      problem: 'filename parameters set where World Machine writes output and cannot be set',
    });
  });

  it('refuses exportAlways: it makes World Machine write output on every full build (spec v2a section 6)', () => {
    expect(parameterText({ name: 'exportAlways', type: 'bool', value: 'false' }, true)).toEqual({
      problem: 'exportAlways makes World Machine write output on every full build and cannot be set',
    });
    expect(parameterText({ name: 'exportAlways', type: 'bool', value: 'false' }, false)).toHaveProperty(
      'problem',
    );
  });

  it("words a bool refusal without implying World Machine's complete list (spec fact 35)", () => {
    expect(parameterText(param('bool'), 'no')).toEqual({
      problem: 'expected true or false, or 1, 0, yes, or off',
    });
  });

  it('explains units for a float', () => {
    expect(parameterText(param('float'), '1.5 km')).toEqual({
      problem:
        "expected a plain decimal number in World Machine's internal units (no units, no decimal comma, no exponent)",
    });
  });
});

describe('parameterInput (float-units design section 3)', () => {
  // raw/float-scale.txt l.1614, l.850, l.1310, l.436, and l.2365.
  const width: Parameter = { name: 'Width', type: 'float', value: '8 km' };
  const height: Parameter = { name: 'Height', type: 'float', value: '0 m' };
  const hardness: Parameter = { name: 'Hardness', type: 'float', value: '0.0' };
  const fold: Parameter = { name: 'foldAngleDeg', type: 'float', value: '30.0°' };
  const area: Parameter = { name: 'meshMinArea', type: 'float', value: '0.0km2' };
  const LENGTH_PROBLEM =
    'expected a plain decimal number in World Machine\'s internal units, or a length in m or km such as "500 m"';
  const UNIT_PROBLEM = 'a unit is accepted only on a float that shows m or km';

  it.each([
    ['500 m', 500],
    ['2.5km', 2500],
    ['-4 km', -4000],
    ['0 m', 0],
  ])('takes %j on a float that shows km as %d m', (given, metres) => {
    expect(parameterInput(width, given)).toEqual({ length: { given, metres } });
  });

  it('takes a length on a float whose listed value is out of range but ends in km (Codex round 4 ruling 2)', () => {
    const huge: Parameter = { name: 'Width', type: 'float', value: `${'9'.repeat(400)} km` };
    expect(parameterInput(huge, '500 m')).toEqual({ length: { given: '500 m', metres: 500 } });
  });

  it('takes a length on a float that shows m', () => {
    expect(parameterInput(height, '656.25 m')).toEqual({ length: { given: '656.25 m', metres: 656.25 } });
  });

  it.each([
    [0.5, '0.5'],
    ['2', '2'],
    [-0.5, '-0.5'],
  ])('returns parameterText itself for the plain value %j: an internal value', (value, text) => {
    expect(parameterInput(width, value)).toEqual({ text });
    expect(parameterInput(width, value)).toEqual(parameterText(width, value));
  });

  // Plan decision P4: a plain decimal, an optional single space, and a non-numeric suffix.
  it.each([['500 ft'], ['3%'], ['1 %'], ['2 km2'], ['1 km2'], ['500 M'], ['1.5 kms']])(
    'refuses the unit attempt %j with the length text',
    (value) => {
      expect(parameterInput(width, value)).toEqual({ problem: LENGTH_PROBLEM });
    },
  );

  it.each([
    ['1,5'],
    ['1e-1'],
    ['5e2 m'],
    [1e-7],
    [true],
    ['500  m'],
    ['.5 km'],
    ['+5 m'],
    ['km'],
    [' 500 m'],
    ['500 m '],
    ['500 m\t'],
    ['500 ft '],
  ])("keeps parameterText's own problem for %j, which is no unit attempt", (value) => {
    expect(parameterInput(width, value)).toEqual(parameterText(width, value));
    expect(parameterInput(width, value)).toEqual({
      problem:
        "expected a plain decimal number in World Machine's internal units (no units, no decimal comma, no exponent)",
    });
  });

  it.each([
    [hardness, '1 m'],
    [fold, '1 m'],
    [area, '1 km'],
  ])('refuses a length on a float that shows %j', (parameter, value) => {
    expect(parameterInput(parameter, value)).toEqual({ problem: UNIT_PROBLEM });
  });

  it.each([
    ['a 400-digit decimal', `${'9'.repeat(400)} m`],
    ['a length below 1e-320 m', `0.${'0'.repeat(329)}1 m`],
  ])('refuses a length out of range: %s (spec section 3)', (_, value) => {
    expect(parameterInput(width, value)).toEqual({ problem: 'the length is out of range' });
  });

  it('takes the smallest double as a length in range (plan decision P9)', () => {
    const given = `0.${'0'.repeat(323)}5 m`;
    expect(parameterInput(width, given)).toEqual({ length: { given, metres: 5e-324 } });
  });

  it('refuses another unit on a float that shows no length with the length text', () => {
    expect(parameterInput(hardness, '1 ft')).toEqual({ problem: LENGTH_PROBLEM });
  });

  it.each([
    ['int', 'expected an integer without a decimal point'],
    ['enum', 'expected the 0-based index of an option, such as 0 or 1'],
    ['bool', 'expected true or false, or 1, 0, yes, or off'],
  ])("gives a unit on an %s that type's own problem text", (type, problem) => {
    expect(parameterInput({ name: 'p', type, value: '0' }, '1 m')).toEqual({ problem });
  });
});
