import { describe, expect, it } from 'vitest';
import {
  ambiguousMatches,
  discoverDeviceTypes,
} from '../../../../../src/adapter/out/worldmachine/capture/discovery.js';
import type { RawResponse } from '../../../../../src/adapter/out/worldmachine/raw-response.js';

type Reply = { output?: string[]; errors?: string[] };

/**
 * A console that adds by exact device name or by a scripted tag, and lists what a batch added. `tags` maps a word to a
 * reply; `kinds` maps a word to the type its device has when that differs from the word.
 */
function fakeConsole(tags: Record<string, Reply>, kinds: Record<string, string> = {}) {
  const batches: string[][] = [];
  let devices: { id: number; name: string; kind?: string }[] = [];
  let next = 1;
  const execute = async (commands: readonly string[]): Promise<RawResponse[]> => {
    batches.push([...commands]);
    return commands.map((command): RawResponse => {
      let reply: Reply = { errors: ['Error: Error: unscripted'] };
      if (command.startsWith('device add ')) {
        const word = command.slice('device add '.length);
        reply = tags[word] ?? { output: ['Device type not found'] };
        if (reply.output?.[0]?.startsWith('Added ')) {
          const kind = kinds[word];
          devices.push({ id: next++, name: word, ...(kind === undefined ? {} : { kind }) });
        }
      } else if (command === 'device list') {
        reply = {
          output:
            devices.length === 0
              ? ['No devices in the current project.']
              : [
                  `Devices (${devices.length} total):`,
                  ...devices.map((d) => `  #${d.id}     ${d.name}${d.kind ? `  (${d.kind})` : ''}`),
                ],
        };
      } else if (command.startsWith('device delete #')) {
        const id = Number(command.slice('device delete #'.length));
        devices = devices.filter((d) => d.id !== id);
        reply = { output: [`Deleted: #${id}`] };
      }
      return { command, output: reply.output ?? [], errors: reply.errors ?? [] };
    });
  };
  return { execute, batches };
}

const added = (name: string): Reply => ({ output: [`Added '${name}'`] });
const ambiguous = (word: string, names: string[]): Reply => ({
  errors: [`Error: Error: Tag '${word}' matches multiple devices: ${names.join(', ')}`],
});

describe('ambiguousMatches', () => {
  it('reads the device names of an ambiguity error', () => {
    expect(
      ambiguousMatches("Error: Error: Tag 'File Output' matches multiple devices: Height Output, VDM Output"),
    ).toEqual(['Height Output', 'VDM Output']);
  });
  it('is undefined for another line', () => {
    expect(ambiguousMatches("Added 'Clamp'")).toBeUndefined();
  });
});

describe('discoverDeviceTypes', () => {
  it('adds a listed type by its own name', async () => {
    const c = fakeConsole({
      Brightness: ambiguous('Brightness', ['Levels']),
      Levels: added('Levels'),
    });
    const found = await discoverDeviceTypes(c.execute, { addWords: ['Brightness'], typeNames: [] });
    expect(found.types).toEqual([{ addName: 'Levels', aliases: [], reached: true }]);
    expect(found.listedByConsole).toBe(true);
    expect(found.notReached).toEqual([]);
    expect(found.sections.map((s) => s.command)).toContain('device add Levels');
  });

  it('keeps a name that adds an existing type as its alias', async () => {
    const c = fakeConsole(
      {
        Rescale: ambiguous('Rescale', ['Clamp', 'Rescale (Clamp)']),
        Clamp: added('Clamp'),
        'Rescale (Clamp)': added('Rescale (Clamp)'),
      },
      { 'Rescale (Clamp)': 'Clamp' },
    );
    const found = await discoverDeviceTypes(c.execute, { addWords: ['Rescale'], typeNames: [] });
    expect(found.types).toEqual([{ addName: 'Clamp', aliases: ['Rescale (Clamp)'], reached: true }]);
  });

  it('names known types it did not reach and drops hidden ones', async () => {
    const c = fakeConsole({
      Gradient: added('Gradient'),
      Secret: { output: ['Cannot add hidden device type.'] },
    });
    const found = await discoverDeviceTypes(c.execute, {
      addWords: ['Gradient', 'Secret'],
      typeNames: ['Gradient', 'VDM Noise'],
    });
    expect(found.types.map((t) => t.addName)).toEqual(['Gradient']);
    expect(found.notReached).toEqual(['VDM Noise']);
  });

  it('falls back to the known lists without the ambiguity error', async () => {
    const c = fakeConsole({ Gradient: added('Gradient'), Curves: added('Curves') });
    const found = await discoverDeviceTypes(c.execute, { addWords: ['Gradient'], typeNames: ['Curves'] });
    expect(found.listedByConsole).toBe(false);
    expect(found.types.map((t) => t.addName)).toEqual(['Gradient', 'Curves']);
  });

  it('adds at most 20 per batch and deletes what it added', async () => {
    const words = Array.from({ length: 25 }, (_, i) => `T${i}`);
    const c = fakeConsole(Object.fromEntries(words.map((w) => [w, added(w)])));
    const found = await discoverDeviceTypes(c.execute, { addWords: words, typeNames: [] });
    expect(found.types).toHaveLength(25);
    const adds = c.batches.filter((b) => b[0]?.startsWith('device add '));
    expect(adds.map((b) => b.filter((x) => x.startsWith('device add ')).length)).toEqual([20, 5]);
    expect(c.batches.flat().filter((x) => x.startsWith('device delete ')).length).toBe(25);
  });
});
