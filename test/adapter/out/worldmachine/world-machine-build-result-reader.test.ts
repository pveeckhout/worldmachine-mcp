import { describe, expect, it } from 'vitest';
import { WorldMachineBuildResultReader } from '../../../../src/adapter/out/worldmachine/world-machine-build-result-reader.js';
import { scriptedSession } from '../../../support/scripted-session.js';
import { fixtureLines, rawFrame } from './parsers/fixture.js';

const timing = (device: number, occurrence = 0) => ({
  output: rawFrame('build-not-built-timing.txt', `debug devicetiming #${device}`, occurrence),
});

// raw/build-not-built-timing.txt: the scene resolution is 513 (fact 93). scene-show.txt prints 2049.
const scene = (resolution: number) => ({
  output: fixtureLines('scene-show.txt').map((line) =>
    line.replace(/Resolution:(\s+)\d+/, `Resolution:$1${resolution}`),
  ),
});

describe('WorldMachineBuildResultReader (build-not-built design sections 4 and 7)', () => {
  it('reads the scene and times every device in one batch, returning the ids with a scene-resolution row, in the order given (facts 93, 95)', async () => {
    const s = scriptedSession({
      'scene show': [scene(513)],
      'debug devicetiming #3': [timing(3)],
      'debug devicetiming #2': [timing(2)],
      'debug devicetiming #1': [timing(1)],
    });
    expect(await new WorldMachineBuildResultReader(s.session).builtDevices([3, 2, 1])).toEqual([1]);
    expect(s.batches).toEqual([
      ['scene show', 'debug devicetiming #3', 'debug devicetiming #2', 'debug devicetiming #1'],
    ]);
  });

  it('counts a device with lower levels only as not built (fact 95)', async () => {
    const s = scriptedSession({
      'scene show': [scene(2049)],
      'debug devicetiming #1': [timing(1)],
    });
    expect(await new WorldMachineBuildResultReader(s.session).builtDevices([1])).toEqual([]);
  });

  it('counts a device that has no build results yet as not built (fact 95)', async () => {
    const s = scriptedSession({
      'scene show': [scene(2049)],
      'debug devicetiming #1': [{ output: rawFrame('build-stop-timing.txt', 'debug devicetiming #1') }],
    });
    expect(await new WorldMachineBuildResultReader(s.session).builtDevices([1])).toEqual([]);
  });

  it('sends nothing for no ids', async () => {
    const s = scriptedSession({});
    expect(await new WorldMachineBuildResultReader(s.session).builtDevices([])).toEqual([]);
    expect(s.batches).toEqual([]);
  });

  it('fails WM_COMMAND_FAILED when World Machine rejects a command', async () => {
    const s = scriptedSession({
      'scene show': [scene(513)],
      'debug devicetiming #9': [{ errors: ["Error: Error: Device not found: '#9'"] }],
    });
    await expect(new WorldMachineBuildResultReader(s.session).builtDevices([9])).rejects.toMatchObject({
      code: 'WM_COMMAND_FAILED',
      message: 'World Machine rejected "debug devicetiming #9"',
    });
  });

  it('fails UNEXPECTED_OUTPUT on another shape', async () => {
    const s = scriptedSession({
      'scene show': [scene(513)],
      'debug devicetiming #1': [{ output: rawFrame('build-not-built-timing.txt', 'debug devicetiming') }],
    });
    await expect(new WorldMachineBuildResultReader(s.session).builtDevices([1])).rejects.toMatchObject({
      code: 'UNEXPECTED_OUTPUT',
    });
  });
});
