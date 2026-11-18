// Device type discovery through the console only (plan 3 task 5). Build 4069 answers `device add <tag>` for an
// ambiguous tag with the names it matches, so every seed is tried as a tag and every listed name by its own name.
import type { DeviceType } from '../../../../domain/catalog.js';
import { parseDeviceList } from '../parsers/device-list.js';
import type { RawResponse } from '../raw-response.js';
import type { Section } from './transcript.js';

export type Discovery = {
  readonly types: readonly DeviceType[];
  /** Known types not added on this build. */
  readonly notReached: readonly string[];
  /** false on a build without the ambiguity error (4067 and earlier): only the known lists were used. */
  readonly listedByConsole: boolean;
  /** For the transcript. */
  readonly sections: readonly Section[];
};

const AMBIGUOUS = /^Error: Error: Tag '.*' matches multiple devices: (.+)$/;
const ADDED = /^Added '.*'$/;
const BATCH = 20;

/** The device names an ambiguity error lists; undefined for any other line. */
export function ambiguousMatches(line: string): readonly string[] | undefined {
  const match = AMBIGUOUS.exec(line.trim());
  return match?.[1] === undefined ? undefined : match[1].split(', ');
}

type MutableType = { addName: string; aliases: string[]; id: string };

const linesOf = (response: RawResponse): string[] => [...response.output, ...response.errors];

export async function discoverDeviceTypes(
  execute: (commands: readonly string[]) => Promise<readonly RawResponse[]>,
  seeds: { readonly addWords: readonly string[]; readonly typeNames: readonly string[] },
): Promise<Discovery> {
  const sections: Section[] = [];
  const run = async (commands: readonly string[]): Promise<readonly RawResponse[]> => {
    const responses = await execute(commands);
    commands.forEach((command, i) => {
      sections.push({ command, lines: linesOf(responses[i] as RawResponse) });
    });
    return responses;
  };

  const queue = [...new Set([...seeds.addWords, ...seeds.typeNames])];
  const tried = new Set(queue);
  const types: MutableType[] = [];
  let listedByConsole = false;

  const record = (word: string, id: string): void => {
    const known = types.find((type) => type.id === id);
    if (known === undefined) {
      types.push({ addName: word, aliases: [], id });
    } else if (known.addName !== word) {
      if (word === id) {
        known.aliases.push(known.addName);
        known.addName = word;
      } else if (!known.aliases.includes(word)) known.aliases.push(word);
    }
  };

  while (queue.length > 0) {
    const words = queue.splice(0, BATCH);
    const responses = await run([...words.map((word) => `device add ${word}`), 'device list']);
    const addedWords: string[] = [];
    words.forEach((word, i) => {
      const lines = linesOf(responses[i] as RawResponse);
      if (lines.some((line) => ADDED.test(line.trim()))) addedWords.push(word);
      for (const name of lines.flatMap((line) => ambiguousMatches(line) ?? [])) {
        listedByConsole = true;
        if (!tried.has(name)) {
          tried.add(name);
          queue.push(name);
        }
      }
    });
    const list = responses[words.length] as RawResponse;
    const devices = addedWords.length === 0 && list.output.length === 0 ? [] : parseDeviceList(list.output);
    if (devices.length < addedWords.length)
      throw new Error(`device list shows ${devices.length} devices after ${addedWords.length} adds`);
    const fresh = devices.slice(devices.length - addedWords.length);
    addedWords.forEach((word, i) => {
      const device = fresh[i];
      if (device !== undefined) record(word, device.kind ?? device.name);
    });
    if (devices.length > 0) await run(devices.map((device) => `device delete #${device.id}`));
  }

  const result: DeviceType[] = types.map((type) => ({
    addName: type.addName,
    aliases: type.aliases,
    reached: true,
  }));
  const reachedNames = new Set(result.flatMap((type) => [type.addName, ...type.aliases]));
  return {
    types: result,
    notReached: [...new Set(seeds.typeNames)].filter((name) => !reachedNames.has(name)),
    listedByConsole,
    sections,
  };
}
