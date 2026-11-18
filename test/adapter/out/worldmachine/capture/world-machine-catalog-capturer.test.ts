import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { WorldMachineCatalogCapturer } from '../../../../../src/adapter/out/worldmachine/capture/world-machine-catalog-capturer.js';
import {
  ENUM_CATALOG_4067,
  ENUM_CATALOG_4069,
} from '../../../../../src/adapter/out/worldmachine/enum-options.js';
import { PORT_TYPE_CATALOG_4067 } from '../../../../../src/adapter/out/worldmachine/world-machine-port-types.js';
import type {
  CaptureResult,
  CaptureRun,
} from '../../../../../src/application/port/out/run-catalog-capture-port.js';
import type { CaptureProgress } from '../../../../../src/domain/catalog-capture.js';
import { simulatedConsole } from '../../../../support/simulated-console.js';

const KNOWN_4067 = {
  addWords: [...new Set(Object.values(PORT_TYPE_CATALOG_4067.types).flatMap((type) => type.added))],
  typeNames: [
    ...new Set([...Object.keys(PORT_TYPE_CATALOG_4067.types), ...Object.keys(ENUM_CATALOG_4067.types)]),
  ],
};

const workDirOf = (build: number, mode: string): string =>
  join(mkdtempSync(join(tmpdir(), 'capture-')), String(build), `.capture-${mode}`);

const shortRun = (build: number, workDir = workDirOf(build, 'short')): CaptureRun => ({
  build,
  mode: 'short',
  base: PORT_TYPE_CATALOG_4067,
  known: KNOWN_4067,
  workDir,
});

// Unambiguous on 4069, with height ports, so a full run stays small.
const FEW = ['Add Noise', 'Blur', 'Advanced Perlin', 'Gradient'];
const fullRun = (workDir = workDirOf(4069, 'full')): CaptureRun => ({
  build: 4069,
  mode: 'full',
  base: PORT_TYPE_CATALOG_4067,
  known: { addWords: FEW, typeNames: FEW },
  workDir,
});

const capturer = new WorldMachineCatalogCapturer({ serverVersion: '0.1.0-test' });
const go = () => new AbortController().signal;
/** A discovery batch: more than twenty adds, then a list. */
const discoveryBatch = (b: readonly string[]): boolean =>
  b.length > 20 && b.every((c) => c.startsWith('device add ') || c === 'device list');

/** The batches of the enum phase: after the discovery, before the port-type phase opens its blank project. */
const enumBatches = (batches: readonly string[][]): string[][] => {
  const portTypes = batches.findIndex((b) => b.length === 2 && b[0] === 'project new blank force');
  return batches.slice(0, portTypes === -1 ? batches.length : portTypes).filter((b) => b.length <= 2);
};

describe('WorldMachineCatalogCapturer', () => {
  let result: CaptureResult;
  let console4069: ReturnType<typeof simulatedConsole>;
  let progress: CaptureProgress[];
  let run: CaptureRun;

  beforeAll(async () => {
    console4069 = simulatedConsole();
    progress = [];
    run = shortRun(4069);
    result = await capturer.run(run, console4069.lease, (p) => progress.push(p), go());
  });

  it('captures a short run from the 4069 fixtures', () => {
    for (const [type, entry] of Object.entries(ENUM_CATALOG_4069.types))
      expect(result.enumOptions.types[type]).toStrictEqual(entry);
    expect(result.enumOptions.build).toBe(4069);
    expect(result.portTypes).toMatchObject({ agreed: true });
    expect(result.discovery.listedByConsole).toBe(true);
  });

  it('sends no device select on 4069', () => {
    expect(console4069.sent().some((c) => c.startsWith('device select'))).toBe(false);
  });

  it('opens a blank project first and ends on a fresh one', () => {
    expect(console4069.batches[0]).toEqual(['project new blank force']);
    expect(console4069.batches.slice(-2)).toEqual([['project close force'], ['project new blank force']]);
    expect(console4069.freshBinds()).toBe(2);
  });

  it('reports only the phases of its mode, discover first', () => {
    const phases = [...new Set(progress.map((p) => p.phase))];
    expect(phases).toEqual(['discover', 'enum', 'sample']);
    for (const p of progress) expect(p.done).toBeLessThanOrEqual(p.total);
  });

  it('writes the transcript of each phase and the resume file', () => {
    expect(JSON.parse(readFileSync(join(run.workDir, 'resume.json'), 'utf8'))).toEqual({
      build: 4069,
      mode: 'short',
      serverVersion: '0.1.0-test',
    });
    for (const file of ['discover.txt', 'enum.txt', 'sample.txt'])
      expect(readFileSync(join(run.workDir, file), 'utf8')).toMatch(/^>>> /);
  });

  it('resumes after a crash', async () => {
    const workDir = workDirOf(4069, 'short');
    const crashAt = (commands: readonly string[]) =>
      commands.length === 2 && commands[0] === 'device add Blur' && commands[1] === 'device list';
    const first = simulatedConsole({ crashWhen: crashAt });
    await expect(capturer.run(shortRun(4069, workDir), first.lease, () => {}, go())).rejects.toMatchObject({
      code: 'CRASHED',
    });
    const done = enumBatches(first.batches)
      .filter((b) => b[0]?.startsWith('device add ') && !crashAt(b))
      .map((b) => b[0]);
    expect(done.length).toBeGreaterThan(3);

    const second = simulatedConsole();
    const result = await capturer.run(shortRun(4069, workDir), second.lease, () => {}, go());
    const again = enumBatches(second.batches).map((b) => b[0]);
    for (const add of done) expect(again).not.toContain(add);
    expect(again).toContain('device add Blur');
    // Discovery finished in the first run: none of its batches (twenty adds and a list) is sent again.
    expect(second.batches.some(discoveryBatch)).toBe(false);
    for (const [type, entry] of Object.entries(ENUM_CATALOG_4069.types))
      expect(result.enumOptions.types[type]).toStrictEqual(entry);
  });

  it('resumes a full probe after the crashed pair', async () => {
    const workDir = workDirOf(4069, 'full');
    const probes = (batches: readonly string[][]) => batches.filter((b) => b[0]?.startsWith('wire connect '));
    // The first run crashes in its second probe batch, which held many pairs.
    let seen = 0;
    const first = simulatedConsole({
      crashWhen: (commands) => commands[0]?.startsWith('wire connect ') === true && ++seen === 2,
    });
    await expect(capturer.run(fullRun(workDir), first.lease, () => {}, go())).rejects.toMatchObject({
      code: 'CRASHED',
    });
    const [answered, suspect] = probes(first.batches) as [string[], string[]];
    const suspectConnects = suspect.filter((c) => c.startsWith('wire connect '));
    expect(suspectConnects.length).toBeGreaterThan(1);

    // The second run probes the suspect pairs one at a time and crashes on the second.
    const culprit = suspectConnects[1] as string;
    const second = simulatedConsole({ crashWhen: (commands) => commands[0] === culprit });
    await expect(capturer.run(fullRun(workDir), second.lease, () => {}, go())).rejects.toMatchObject({
      code: 'CRASHED',
    });
    const secondProbes = probes(second.batches);
    expect(secondProbes).not.toContainEqual(answered);
    expect(secondProbes[0]?.filter((c) => c.startsWith('wire connect '))).toEqual([suspectConnects[0]]);
    expect(readFileSync(join(workDir, 'probe.txt'), 'utf8')).toMatch(/ crashed$/m);

    // The third run goes on after the crashed pair, never sending it again, and parses a strict catalog.
    const third = simulatedConsole();
    const result = await capturer.run(fullRun(workDir), third.lease, () => {}, go());
    expect(third.sent()).not.toContain(culprit);
    expect(probes(third.batches)).not.toContainEqual(answered);
    expect(result.portTypes).toMatchObject({ agreed: true, catalog: { build: 4069, kind: 'strict' } });
    const catalog = (
      result.portTypes as {
        catalog: { types: Record<string, unknown>; outputClasses: Record<string, string> };
      }
    ).catalog;
    expect(Object.keys(catalog.types)).toEqual(expect.arrayContaining(FEW));
    // Named after the 4067 catalog where the members match, else generated.
    for (const name of Object.values(catalog.outputClasses)) expect(name).not.toBe('');
  });

  it('does not resume a transcript of another build', async () => {
    const workDir = workDirOf(4071, 'short');
    mkdirSync(workDir, { recursive: true });
    writeFileSync(
      join(workDir, 'resume.json'),
      JSON.stringify({ build: 4069, mode: 'short', serverVersion: 'x' }),
    );
    writeFileSync(join(workDir, 'enum.txt'), '>>> (enum Old Word)\ntype Old Type\n<<<\n');
    writeFileSync(join(workDir, 'discovery.json'), '{"types":[],"notReached":[],"listedByConsole":false}');
    const wm = simulatedConsole({ build: 4071 });
    const result = await capturer.run(shortRun(4071, workDir), wm.lease, () => {}, go());
    const parent = join(workDir, '..');
    const stale = readdirSync(parent).filter((name) => name.startsWith('.capture-short.stale-'));
    expect(stale).toHaveLength(1);
    expect(readFileSync(join(parent, stale[0] as string, 'enum.txt'), 'utf8')).toContain('Old Word');
    expect(readFileSync(join(workDir, 'enum.txt'), 'utf8')).not.toContain('Old Word');
    expect(JSON.parse(readFileSync(join(workDir, 'resume.json'), 'utf8'))).toMatchObject({ build: 4071 });
    // A fresh run: discovery ran again.
    expect(wm.batches.some(discoveryBatch)).toBe(true);
    expect(result.enumOptions.build).toBe(4071);
  });

  it('refuses a World Machine of another build than the run', async () => {
    const wm = simulatedConsole({ build: 4071 });
    await expect(capturer.run(shortRun(4069), wm.lease, () => {}, go())).rejects.toThrow(/build 4071/);
  });

  it('stops between batches when cancelled and keeps the transcript', async () => {
    const workDir = workDirOf(4069, 'short');
    const controller = new AbortController();
    const wm = simulatedConsole({
      crashWhen: (commands) => {
        if (commands[0] === 'device add Blur' && commands.length === 2) controller.abort();
        return false;
      },
    });
    await expect(
      capturer.run(shortRun(4069, workDir), wm.lease, () => {}, controller.signal),
    ).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(existsSync(join(workDir, 'enum.txt'))).toBe(true);
    expect(wm.batches.slice(-2)).toEqual([['project close force'], ['project new blank force']]);
  });

  it('removes a working folder on discard', () => {
    const workDir = workDirOf(4069, 'short');
    mkdirSync(workDir, { recursive: true });
    writeFileSync(join(workDir, 'enum.txt'), '');
    capturer.discard(workDir);
    expect(existsSync(workDir)).toBe(false);
  });
});
