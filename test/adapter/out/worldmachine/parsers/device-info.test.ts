import { describe, expect, it } from 'vitest';
import { parseDeviceInfo } from '../../../../../src/adapter/out/worldmachine/parsers/device-info.js';
import { codeOf, fixtureLines, rawFrame } from './fixture.js';

describe('parseDeviceInfo', () => {
  it('reads name, type, enabled, and bypass', () => {
    expect(parseDeviceInfo(fixtureLines('device-info-erosion.txt'))).toEqual({
      name: 'Erosion',
      type: 'Erosion',
      enabled: true,
      bypassed: false,
    });
  });

  it('reads the build 4069 form, headed by the device id and followed by its build results', () => {
    expect(parseDeviceInfo(rawFrame('v5-read-formats.txt', 'device info', 0, '4069'))).toEqual({
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

  it.each([
    [['No device selected.']],
    [['Selected device:', '  Name:    X']],
    [['Device #x:', '  Name:    X', '  Type:    X', '  Enabled: yes', '  Bypass:  no']],
    [[]],
  ])('fails with UNEXPECTED_OUTPUT on %j', (lines) => {
    expect(codeOf(() => parseDeviceInfo(lines))).toBe('UNEXPECTED_OUTPUT');
  });
});
