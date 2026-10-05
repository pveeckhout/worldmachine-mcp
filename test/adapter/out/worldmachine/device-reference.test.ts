import { describe, expect, it } from 'vitest';
import {
  assertReadableDeviceName,
  findListedDevice,
  idOfReference,
  matchesListedName,
  resolveDeviceReference,
} from '../../../../src/adapter/out/worldmachine/device-reference.js';
import { parseDeviceList } from '../../../../src/adapter/out/worldmachine/parsers/device-list.js';
import type { DeviceSummary } from '../../../../src/domain/device.js';
import { fixtureLines } from './parsers/fixture.js';

const SAMPLE = parseDeviceList(fixtureLines('device-list.txt'));
const device = (id: number, name: string): DeviceSummary => ({ id, name, enabled: true, bypassed: false });
// Two devices of one name (spec fact 30), ids as captured in raw/p2b-kind-markers.txt.
const TWO_GRADIENTS = [device(536, 'Gradient'), device(537, 'Gradient')];
// Two names that differ only in case.
const GRAD_TWICE = [device(1, 'Grad'), device(2, 'grad')];

/** The error `action` throws; fails the test when it throws nothing. */
function thrown(action: () => unknown): { code?: string; message?: string } {
  try {
    action();
  } catch (error) {
    return error as { code?: string; message?: string };
  }
  throw new Error('expected an error');
}

describe('resolveDeviceReference', () => {
  it('passes #<id> through, listed or not', () => {
    expect(resolveDeviceReference(SAMPLE, '#35')).toBe('#35');
    expect(resolveDeviceReference([], '#999')).toBe('#999');
  });

  it('resolves a name that matches exactly one device to #<id>', () => {
    expect(resolveDeviceReference(SAMPLE, 'Erosion')).toBe('#35');
  });

  it('resolves a name with a (kind) suffix and with a state marker', () => {
    expect(resolveDeviceReference(SAMPLE, 'Easy Distortion')).toBe('#319');
    // Row text as captured in raw/p2b-kind-markers.txt (spec fact 29).
    const marked = parseDeviceList([
      'Devices (1 total):',
      '  #319   Easy Distortion          (Macro) [disabled]',
    ]);
    expect(resolveDeviceReference(marked, 'Easy Distortion')).toBe('#319');
  });

  it('resolves a name in another case to #<id> (spec fact 31)', () => {
    expect(resolveDeviceReference(SAMPLE, 'erosion')).toBe('#35');
    expect(resolveDeviceReference(SAMPLE, 'EASY DISTORTION')).toBe('#319');
  });

  it('returns a name no device has unchanged, so World Machine reports it', () => {
    expect(resolveDeviceReference(SAMPLE, 'Nope')).toBe('Nope');
    expect(resolveDeviceReference([], 'Erosion')).toBe('Erosion');
  });

  it('refuses a name shared by several devices', () => {
    expect(thrown(() => resolveDeviceReference(TWO_GRADIENTS, 'Gradient'))).toMatchObject({
      code: 'REFUSED',
      message: "Device name 'Gradient' is ambiguous; use #<id>",
    });
  });

  it('refuses a name that several devices have in different cases', () => {
    expect(thrown(() => resolveDeviceReference(GRAD_TWICE, 'GRAD'))).toMatchObject({
      code: 'REFUSED',
      message: "Device name 'GRAD' is ambiguous; use #<id>",
    });
    expect(thrown(() => resolveDeviceReference(GRAD_TWICE, 'grad'))).toMatchObject({ code: 'REFUSED' });
  });
});

describe('idOfReference', () => {
  it('reads the id of #<id> and nothing else', () => {
    expect(idOfReference('#35')).toBe(35);
    expect(idOfReference('Erosion')).toBeUndefined();
    expect(idOfReference('#35 x')).toBeUndefined();
    expect(idOfReference('#')).toBeUndefined();
  });
});

describe('findListedDevice', () => {
  it('returns the listed device for #<id> and for a name in any case', () => {
    expect(findListedDevice(SAMPLE, '#35')).toEqual({
      id: 35,
      name: 'Erosion',
      enabled: true,
      bypassed: false,
    });
    expect(findListedDevice(SAMPLE, 'erosion').id).toBe(35);
  });

  it('refuses a name or an id the list does not have', () => {
    expect(thrown(() => findListedDevice(SAMPLE, 'Nope'))).toMatchObject({
      code: 'REFUSED',
      message: "No device 'Nope' in the current project; see list_devices",
    });
    expect(thrown(() => findListedDevice(SAMPLE, '#999'))).toMatchObject({ code: 'REFUSED' });
  });

  it('refuses a name several devices share', () => {
    expect(thrown(() => findListedDevice(TWO_GRADIENTS, 'Gradient'))).toMatchObject({
      code: 'REFUSED',
      message: "Device name 'Gradient' is ambiguous; use #<id>",
    });
  });
});

describe('assertReadableDeviceName', () => {
  it.each(['Grad A', 'Ridge (north)', 'Grad[disabled]', '#1a', 'ABCDEFGHIJKLMNOPQRSTUVW'])(
    'accepts %j',
    (name) => {
      expect(() => assertReadableDeviceName(name)).not.toThrow();
    },
  );

  it.each([
    [' Grad', 'start or end with whitespace'],
    ['Grad ', 'start or end with whitespace'],
    ['Grad [disabled]', 'end with [disabled] or [bypassed]'],
    ['Grad [bypassed]', 'end with [disabled] or [bypassed]'],
    ['Grad  (Macro)', 'end with two spaces and parenthesised text'],
    ['#12', 'look like a device id (#<n>)'],
    ['ABCDEFGHIJKLMNOPQRSTUVWX', 'be longer than 23 characters'],
  ])('refuses %j', (name, rule) => {
    expect(thrown(() => assertReadableDeviceName(name))).toMatchObject({
      code: 'REFUSED',
      message: `Device name '${name}' must not ${rule}: device list could not show it unambiguously`,
    });
  });
});

describe('matchesListedName', () => {
  it('matches equal names', () => {
    expect(matchesListedName('Gradient', 'Gradient')).toBe(true);
  });

  it('matches a longer name by its first 23 characters (spec fact 33)', () => {
    expect(matchesListedName('A very long device name that goes on', 'A very long device name')).toBe(true);
  });

  it('trims trailing whitespace left by the cut', () => {
    expect(matchesListedName('Twenty-one characters  and more', 'Twenty-one characters')).toBe(true);
  });

  it('rejects a different name', () => {
    expect(matchesListedName('Combiner', 'Gradient')).toBe(false);
  });

  it('rejects a name that differs within the first 23 characters', () => {
    expect(matchesListedName('A very long device nane that goes on', 'A very long device name')).toBe(false);
  });
});
