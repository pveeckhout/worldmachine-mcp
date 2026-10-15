import { describe, expect, it } from 'vitest';
import {
  deviceNameProblem,
  foldCase,
  idOfReference,
  LISTED_NAME_LIMIT,
  listedName,
  matchesListedName,
  sceneNameProblem,
} from '../../src/domain/device-name.js';

describe('device names (spec facts 31, 33, 77; Plan 2c decision D5)', () => {
  it('accepts names device list can show, up to 23 characters', () => {
    expect(deviceNameProblem('Erosion')).toBeUndefined();
    expect(deviceNameProblem('Twenty-three characters')).toBeUndefined();
    expect('Twenty-three characters').toHaveLength(LISTED_NAME_LIMIT);
  });

  it.each([
    [' Lead', 'start or end with whitespace'],
    ['Trail ', 'start or end with whitespace'],
    ['Noise [disabled]', 'end with [disabled] or [bypassed]'],
    ['Noise [bypassed]', 'end with [disabled] or [bypassed]'],
    ['Noise  (Perlin)', 'end with two spaces and parenthesised text'],
    ['#3', 'look like a device id (#<n>)'],
    ['Twenty-four characters!!', 'be longer than 23 characters'],
  ])('names the rule %j breaks', (name, rule) => {
    expect(deviceNameProblem(name)).toBe(rule);
  });

  it('reads a printed name as device list lists it', () => {
    expect(listedName('A'.repeat(30))).toBe('A'.repeat(23));
    expect(listedName(`${'a'.repeat(22)} tail`)).toBe('a'.repeat(22));
    expect(matchesListedName('A'.repeat(30), 'A'.repeat(23))).toBe(true);
    expect(matchesListedName('Erosion', 'erosion')).toBe(false);
  });

  it('folds case and reads #<id> references', () => {
    expect(foldCase('ERODED')).toBe('eroded');
    expect(idOfReference('#12')).toBe(12);
    expect(idOfReference('12')).toBeUndefined();
    expect(idOfReference('#12.1')).toBeUndefined();
  });
});

describe('scene names (revision 8)', () => {
  it('accepts a name scene name can carry', () => {
    expect(sceneNameProblem('Main Extents')).toBeUndefined();
    expect(sceneNameProblem('Probe Scene')).toBeUndefined();
  });

  it.each([
    ["Pieter's map", 'contain a quote, an apostrophe, or a backslash'],
    ['The "Main" scene', 'contain a quote, an apostrophe, or a backslash'],
    ['back\\slash', 'contain a quote, an apostrophe, or a backslash'],
    [' Main', 'start or end with whitespace'],
    ['Main ', 'start or end with whitespace'],
    ['   ', 'be blank'],
    ['', 'be blank'],
    ['a\nscene show', 'contain control characters such as newlines'],
    ['tab\there', 'contain control characters such as newlines'],
    ['line\u2028separator', 'contain control characters such as newlines'],
    ['__end_x', 'start with the reserved prefix __end_'],
  ])('names the rule %j breaks', (name, rule) => {
    expect(sceneNameProblem(name)).toBe(rule);
  });
});
