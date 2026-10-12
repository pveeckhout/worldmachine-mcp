import { describe, expect, it } from 'vitest';
import { internalText, matchesLength, parseLength, showsLength } from '../../src/domain/lengths.js';

describe('parseLength (float-units design section 3)', () => {
  it.each([
    ['500 m', 500],
    ['2.5km', 2500],
    ['-4 km', -4000],
    ['0 m', 0],
    // Displayed values: raw/float-scale.txt l.1614 and l.860, raw/float-scale-default.txt l.108 and l.114.
    ['8 km', 8000],
    ['3000 m', 3000],
    ['2625 m', 2625],
    ['656.2 m', 656.2],
  ])('reads %j as %d m', (text, metres) => {
    expect(parseLength(text)).toBe(metres);
  });

  it.each([
    ['500'],
    ['500 ft'],
    ['1 %'],
    ['1 km2'],
    // raw/float-scale.txt l.2365 and l.436: units that are not lengths.
    ['0.0km2'],
    ['30.0°'],
    ['500  m'],
    [' 500 m'],
    ['500 m '],
    ['500 M'],
    ['5e2 m'],
    ['.5 km'],
    ['+5 m'],
    ['1,5 km'],
    ['km'],
    [''],
  ])('refuses %j', (text) => {
    expect(parseLength(text)).toBeUndefined();
  });

  // Spec section 3: well-formed, but out of range for a double (Infinity, or 0 for a decimal that is not zero).
  it.each([
    ['a 400-digit decimal', `${'9'.repeat(400)} m`],
    ['a length below 1e-320 m', `0.${'0'.repeat(329)}1 m`],
    ['a km length that overflows when multiplied', `${'9'.repeat(306)} km`],
  ])('is undefined for a length out of range: %s', (_, text) => {
    expect(matchesLength(text)).toBe(true);
    expect(parseLength(text)).toBeUndefined();
  });

  it('reads a zero decimal and the smallest double as lengths in range', () => {
    expect(parseLength('0.000 km')).toBe(0);
    expect(parseLength(`0.${'0'.repeat(323)}5 m`)).toBe(5e-324);
  });
});

describe('showsLength (float-units design section 3)', () => {
  // raw/float-scale.txt l.1614 (`8 km`), l.850 (`0 m`), l.4336 (`10 m`); raw/float-scale-default.txt l.114.
  it.each([['8 km'], ['0 m'], ['10 m'], ['656.2 m']])('is true for %j', (display) => {
    expect(showsLength(display)).toBe(true);
  });

  // raw/float-scale.txt l.1310 (`0.0`), l.762 (`0.5`), l.436 (`30.0°`), l.2365 (`0.0km2`).
  it.each([['0.0'], ['0.5'], ['30.0°'], ['0.0km2'], ['']])('is false for %j', (display) => {
    expect(showsLength(display)).toBe(false);
  });

  it('is true for a listed value out of range that still ends in a unit: grammar only', () => {
    expect(parseLength(`${'9'.repeat(400)} km`)).toBeUndefined();
    expect(showsLength(`${'9'.repeat(400)} km`)).toBe(true);
  });
});

describe('internalText (float-units design section 4)', () => {
  it.each([
    [500, 8000, '0.0625'],
    [656.25, 2625, '0.25'],
    [-4000, 8000, '-0.5'],
    [8000, 8000, '1'],
    [1000, 3000, '0.333333333333'],
    [2000, 3000, '0.666666666667'],
    [0.001, 8000, '0.000000125'],
    [1e15, 1, '1000000000000000'],
    [123456789012345, 1, '123456789012000'],
    [0, 8000, '0'],
    [-0, 2625, '0'],
  ])('writes %d m at %d m per unit as %j', (metres, scaleMetres, text) => {
    expect(internalText(metres, scaleMetres)).toBe(text);
  });

  it('rounds away the binary noise of a km length: 1.005 km at 8 km is 0.125625', () => {
    const metres = parseLength('1.005 km');
    expect(metres).not.toBe(1005);
    expect(internalText(metres ?? Number.NaN, 8000)).toBe('0.125625');
  });

  // Spec section 4: a quotient that is not finite, or zero for a non-zero length, is out of range at that scale.
  it.each([
    ['an underflow at 8 km', 5e-324, 8000],
    ['an underflow at 2625 m', 5e-324, 2625],
    ['a division by zero', 1, 0],
    ['an overflow below 1 m per unit', Number.MAX_VALUE, 0.5],
  ])('is undefined when the quotient is out of range: %s', (_, metres, scaleMetres) => {
    expect(internalText(metres, scaleMetres)).toBeUndefined();
  });
});
