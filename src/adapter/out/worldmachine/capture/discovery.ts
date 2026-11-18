// Device type discovery through the console only (plan 3 task 5). Build 4069 answers `device add <tag>` for an
// ambiguous tag with the names it matches, so every seed is tried as a tag and every listed name by its own name.
import { checkDeviceTypes, type DeviceDiscovery, type DeviceType } from '../../../../domain/catalog.js';
import type { DeviceSummary } from '../../../../domain/device.js';
import { WorldMachineError } from '../../../../domain/errors.js';
import { parseDeviceList } from '../parsers/device-list.js';
import type { RawResponse } from '../raw-response.js';
import type { Section } from './transcript.js';

export type Discovery = DeviceDiscovery & {
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
    if (responses.length < commands.length)
      throw new Error(`World Machine answered ${responses.length} of ${commands.length} commands`);
    commands.forEach((command, i) => {
      sections.push({ command, lines: linesOf(responses[i] as RawResponse) });
    });
    return responses;
  };
  const listDevices = async (): Promise<DeviceSummary[]> =>
    parseDeviceList(((await run(['device list']))[0] as RawResponse).output);
  const deleteDevices = async (devices: readonly DeviceSummary[]): Promise<void> => {
    if (devices.length === 0) return;
    const responses = await run(devices.map((device) => `device delete #${device.id}`));
    devices.forEach((device, i) => {
      const lines = linesOf(responses[i] as RawResponse);
      if (!lines.some((line) => line.trim() === `Deleted: #${device.id}`))
        throw new WorldMachineError(
          'WM_COMMAND_FAILED',
          `World Machine did not delete device #${device.id} (${device.name}) added by discovery`,
          lines.join('\n'),
        );
    });
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

  const known = new Set((await listDevices()).map((device) => device.id));

  while (queue.length > 0) {
    const words = queue.splice(0, BATCH);
    let fresh: DeviceSummary[] = [];
    let failed = false;
    try {
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
      fresh = parseDeviceList((responses[words.length] as RawResponse).output).filter(
        (device) => !known.has(device.id),
      );
      if (fresh.length !== addedWords.length)
        throw new Error(`device list shows ${fresh.length} new devices after ${addedWords.length} adds`);
      addedWords.forEach((word, i) => {
        const device = fresh[i] as DeviceSummary;
        record(word, device.kind ?? device.name);
      });
    } catch (error) {
      failed = true;
      // Still try to remove what the batch added; the original error is the one to report.
      try {
        const rows = fresh.length > 0 ? fresh : (await listDevices()).filter((d) => !known.has(d.id));
        await deleteDevices(rows);
      } catch {
        // ignored: the original error follows
      }
      throw error;
    } finally {
      if (!failed) await deleteDevices(fresh);
    }
  }

  const result: DeviceType[] = types.map((type) => ({
    addName: type.addName,
    aliases: type.aliases,
    reached: true,
  }));
  const reachedNames = new Set(result.flatMap((type) => [type.addName, ...type.aliases]));
  checkDeviceTypes(result);
  return {
    types: result,
    notReached: [...new Set(seeds.typeNames)].filter((name) => !reachedNames.has(name)),
    listedByConsole,
    sections,
  };
}
