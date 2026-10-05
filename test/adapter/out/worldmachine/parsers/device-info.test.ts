import { describe, expect, it } from 'vitest';
import { parseDeviceInfo } from '../../../../../src/adapter/out/worldmachine/parsers/device-info.js';
import { codeOf, fixtureLines } from './fixture.js';

describe('parseDeviceInfo', () => {
  it('reads name, type, enabled, and bypass', () => {
    expect(parseDeviceInfo(fixtureLines('device-info-erosion.txt'))).toEqual({
      name: 'Erosion',
      type: 'Erosion',
      enabled: true,
      bypassed: false,
    });
  });

  it('reads disabled and bypassed devices', () => {
    expect(
      parseDeviceInfo([
        'Selected device:',
        '  Name:    My Output',
        '  Type:    File Output',
        '  Enabled: no',
        '  Bypass:  yes',
      ]),
    ).toEqual({ name: 'My Output', type: 'File Output', enabled: false, bypassed: true });
  });

  it.each([[['No device selected.']], [['Selected device:', '  Name:    X']], [[]]])(
    'fails with UNEXPECTED_OUTPUT on %j',
    (lines) => {
      expect(codeOf(() => parseDeviceInfo(lines))).toBe('UNEXPECTED_OUTPUT');
    },
  );
});
