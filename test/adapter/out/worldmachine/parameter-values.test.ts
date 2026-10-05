import { describe, expect, it } from 'vitest';
import { decimalText, parameterText } from '../../../../src/adapter/out/worldmachine/parameter-values.js';
import type { Parameter } from '../../../../src/domain/device.js';

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
