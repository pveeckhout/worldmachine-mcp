import { describe, expect, it } from 'vitest';
import { WorldMachineBuildResultReader } from '../../../../src/adapter/out/worldmachine/world-machine-build-result-reader.js';
import { scriptedSession } from '../../../support/scripted-session.js';
import { rawFrame } from './parsers/fixture.js';

const timing = (device: number, occurrence = 0) => ({
  output: rawFrame('build-not-built-timing.txt', `debug devicetiming #${device}`, occurrence),
});

describe('WorldMachineBuildResultReader (build-not-built design sections 4 and 7)', () => {
  it('times every device in one batch and returns the ids with a result, in the order given (fact 93)', async () => {
    const s = scriptedSession({
      'debug devicetiming #3': [timing(3)],
      'debug devicetiming #2': [timing(2)],
      'debug devicetiming #1': [timing(1)],
    });
    expect(await new WorldMachineBuildResultReader(s.session).builtDevices([3, 2, 1])).toEqual([1]);
    expect(s.batches).toEqual([['debug devicetiming #3', 'debug devicetiming #2', 'debug devicetiming #1']]);
  });

  it('sends nothing for no ids', async () => {
    const s = scriptedSession({});
    expect(await new WorldMachineBuildResultReader(s.session).builtDevices([])).toEqual([]);
    expect(s.batches).toEqual([]);
  });

  it('fails WM_COMMAND_FAILED when World Machine rejects a command', async () => {
    const s = scriptedSession({
      'debug devicetiming #9': [{ errors: ["Error: Error: Device not found: '#9'"] }],
    });
    await expect(new WorldMachineBuildResultReader(s.session).builtDevices([9])).rejects.toMatchObject({
      code: 'WM_COMMAND_FAILED',
      message: 'World Machine rejected "debug devicetiming #9"',
    });
  });

  it('fails UNEXPECTED_OUTPUT on another shape', async () => {
    const s = scriptedSession({
      'debug devicetiming #1': [{ output: rawFrame('build-not-built-timing.txt', 'debug devicetiming') }],
    });
    await expect(new WorldMachineBuildResultReader(s.session).builtDevices([1])).rejects.toMatchObject({
      code: 'UNEXPECTED_OUTPUT',
    });
  });
});
