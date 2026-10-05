import { describe, expect, it } from 'vitest';
import { listAllDevices, lookUpDevice } from '../../../../src/adapter/out/worldmachine/device-lookup.js';
import { scriptedSession } from '../../../support/scripted-session.js';

// raw/p2b-graph-edits.txt l.17-19.
const TWO_DEVICES = [
  'Devices (2 total):',
  '  #1     Gradient                ',
  '  #2     Combiner                ',
];

describe('lookUpDevice', () => {
  it('runs one device list and returns the device a name in another case names', async () => {
    const s = scriptedSession({ 'device list': [{ output: TWO_DEVICES }] });
    expect(await lookUpDevice(s.session, 'combiner')).toEqual({
      id: 2,
      name: 'Combiner',
      enabled: true,
      bypassed: false,
    });
    expect(s.batches).toEqual([['device list']]);
  });

  it('refuses a device the list does not have', async () => {
    const s = scriptedSession({ 'device list': [{ output: TWO_DEVICES }] });
    await expect(lookUpDevice(s.session, '#9')).rejects.toMatchObject({ code: 'REFUSED' });
  });

  it('reports a rejected device list', async () => {
    const s = scriptedSession({ 'device list': [{ errors: ['Error: boom'] }] });
    await expect(lookUpDevice(s.session, '#1')).rejects.toMatchObject({ code: 'WM_COMMAND_FAILED' });
  });
});

describe('listAllDevices', () => {
  it('reads an empty project as no devices (spec fact 16)', async () => {
    const s = scriptedSession({ 'device list': [{ output: ['No devices in the current project.'] }] });
    expect(await listAllDevices(s.session)).toEqual([]);
  });
});
