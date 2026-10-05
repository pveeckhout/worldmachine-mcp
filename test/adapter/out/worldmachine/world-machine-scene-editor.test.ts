import { describe, expect, it } from 'vitest';
import { WorldMachineSceneEditor } from '../../../../src/adapter/out/worldmachine/world-machine-scene-editor.js';
import { scriptedSession } from '../../../support/scripted-session.js';

// raw/p2b-graph-edits.txt l.232-238, with the resolution the tests request (ruling K6).
// Assumed: no capture shows scene show right after scene resolution 1025 (accepted, p2b-graph-edits.txt l.219-220).
const SHOW = [
  "Scene 'Capture Scene' (index 0 of 1):",
  '  Origin (center): 1.50, -2.00 km',
  '  Size:            8.00 x 4.00 km',
  '  Lower-left:      -2.50, -4.00 km',
  '  Upper-right:     5.50, 0.00 km',
  '  Resolution:      1025',
  '  Locked:          no',
];
const SHOWN = {
  name: 'Capture Scene',
  index: 0,
  count: 1,
  originKm: { x: 1.5, y: -2 },
  sizeKm: { width: 8, height: 4 },
  resolution: 1025,
  locked: false,
};
// raw/p2b-graph-edits.txt l.191-192, 197-198, 207-208, 219-220 (spec fact 27).
const NAME = {
  'scene name Capture Scene': [{ output: ["Renamed scene from 'Main Extents' to 'Capture Scene'"] }],
};
const ORIGIN = { 'scene origin 1.5 -2': [{ output: ['Set scene origin to (1.50, -2.00) km'] }] };
const SIZE = { 'scene size 8 4': [{ output: ['Set scene size to 8.00 x 4.00 km'] }] };
const RESOLUTION = { 'scene resolution 1025': [{ output: ['Set scene resolution to 1025'] }] };

const editor = (s: ReturnType<typeof scriptedSession>) => new WorldMachineSceneEditor(s.session);

describe('WorldMachineSceneEditor', () => {
  it('applies all settings in one batch and returns scene show', async () => {
    const s = scriptedSession({
      ...NAME,
      ...ORIGIN,
      ...SIZE,
      ...RESOLUTION,
      'scene show': [{ output: SHOW }],
    });
    expect(
      await editor(s).configureScene({
        name: 'Capture Scene',
        originKm: { x: 1.5, y: -2 },
        sizeKm: { width: 8, height: 4 },
        resolution: 1025,
      }),
    ).toEqual(SHOWN);
    expect(s.batches).toEqual([
      [
        'scene name Capture Scene',
        'scene origin 1.5 -2',
        'scene size 8 4',
        'scene resolution 1025',
        'scene show',
      ],
    ]);
    expect(s.dirtyMarks()).toBe(1);
  });

  it('sends only the settings given', async () => {
    const s = scriptedSession({ ...RESOLUTION, 'scene show': [{ output: SHOW }] });
    await editor(s).configureScene({ resolution: 1025 });
    expect(s.batches).toEqual([['scene resolution 1025', 'scene show']]);
  });

  it.each([
    ['no settings', {}],
    ['an exponent', { originKm: { x: 1e-7, y: 0 } }],
    ['a zero size', { sizeKm: { width: 0, height: 4 } }],
    ['a fractional resolution', { resolution: 1.5 }],
    ['a zero resolution', { resolution: 0 }],
    ['a name with a quote', { name: "it's" }],
  ])('refuses %s before sending', async (_label, changes) => {
    const s = scriptedSession({});
    await expect(editor(s).configureScene(changes)).rejects.toMatchObject({ code: 'REFUSED' });
    expect(s.batches).toEqual([]);
  });

  it('reports a rejected setter, names the applied ones, and marks the project modified', async () => {
    const s = scriptedSession({
      ...NAME,
      // Assumed (still uncaptured): one setter rejected while another is applied. No captured input does this after
      // the editor's own checks; the error line is the captured one for `scene size 0 0` (raw/p2b-graph-edits.txt
      // l.210-211), standing in for any rejection.
      'scene size 8 4': [{ errors: ['Error: Error: Width and height must be positive numbers.'] }],
      'scene show': [{ output: SHOW }],
    });
    await expect(
      editor(s).configureScene({ name: 'Capture Scene', sizeKm: { width: 8, height: 4 } }),
    ).rejects.toMatchObject({
      code: 'WM_COMMAND_FAILED',
      message:
        'World Machine rejected "scene size 8 4"; it applied name, and undo reverts one setting per call',
      worldMachineMessage: 'Error: Error: Width and height must be positive numbers.',
    });
    expect(s.dirtyMarks()).toBe(1);
  });

  it('names only confirmed setters as applied and reports one accepted without its line (ruling K2)', async () => {
    const s = scriptedSession({
      ...NAME,
      // Assumed: a setter accepted without its confirmation line; no capture shows one.
      'scene size 8 4': [{ output: [] }],
      // Assumed: a setter rejected after others were accepted; the captured line of raw/p2b-graph-edits.txt
      // l.228-229 stands in for any rejection.
      'scene resolution 1025': [
        { errors: ['Error: Error: Usage: scene resolution [value|up|down] [count]'] },
      ],
      'scene show': [{ output: SHOW }],
    });
    await expect(
      editor(s).configureScene({ name: 'Capture Scene', sizeKm: { width: 8, height: 4 }, resolution: 1025 }),
    ).rejects.toMatchObject({
      code: 'WM_COMMAND_FAILED',
      message:
        'World Machine rejected "scene resolution 1025"; it applied name, and undo reverts one setting per call; it accepted size without the confirmation line, so the effect is unknown',
    });
    expect(s.dirtyMarks()).toBe(1);
  });

  it('reports a setter accepted without its line as UNEXPECTED_OUTPUT, naming the confirmed ones (ruling K2)', async () => {
    const s = scriptedSession({
      ...NAME,
      // Assumed: a setter accepted without its confirmation line; no capture shows one.
      'scene size 8 4': [{ output: [] }],
      'scene show': [{ output: SHOW }],
    });
    await expect(
      editor(s).configureScene({ name: 'Capture Scene', sizeKm: { width: 8, height: 4 } }),
    ).rejects.toMatchObject({
      code: 'UNEXPECTED_OUTPUT',
      message: expect.stringContaining('World Machine applied name, and undo reverts one setting per call.'),
    });
    expect(s.dirtyMarks()).toBe(1);
  });

  it("reports a locked scene with World Machine's text and leaves dirty alone (spec fact 38)", async () => {
    const LOCKED = "Error: Error: Scene is locked. Use 'scene lock off' to unlock before making changes.";
    const s = scriptedSession({
      // raw/p2c-edits.txt l.293-312.
      'scene name Locked Name': [{ errors: [LOCKED] }],
      'scene origin 1 1': [{ errors: [LOCKED] }],
      'scene size 4 4': [{ errors: [LOCKED] }],
      'scene resolution 512': [{ errors: [LOCKED] }],
      'scene show': [
        {
          output: [
            "Scene 'Main Extents' (index 0 of 1):",
            '  Origin (center): 4.00, 4.00 km',
            '  Size:            8.00 x 8.00 km',
            '  Lower-left:      0.00, 0.00 km',
            '  Upper-right:     8.00, 8.00 km',
            '  Resolution:      1024',
            '  Locked:          yes',
          ],
        },
      ],
    });
    await expect(
      editor(s).configureScene({
        name: 'Locked Name',
        originKm: { x: 1, y: 1 },
        sizeKm: { width: 4, height: 4 },
        resolution: 512,
      }),
    ).rejects.toMatchObject({
      code: 'WM_COMMAND_FAILED',
      message: 'World Machine rejected "scene name Locked Name"',
      worldMachineMessage: LOCKED,
    });
    expect(s.dirtyMarks()).toBe(0);
  });

  it('reports a missing confirmation as UNEXPECTED_OUTPUT, with the project modified', async () => {
    const s = scriptedSession({
      // Assumed: accepted without its confirmation line; no capture shows one.
      'scene resolution 1025': [{ output: [] }],
      'scene show': [{ output: SHOW }],
    });
    await expect(editor(s).configureScene({ resolution: 1025 })).rejects.toMatchObject({
      code: 'UNEXPECTED_OUTPUT',
    });
    expect(s.dirtyMarks()).toBe(1);
  });
});
