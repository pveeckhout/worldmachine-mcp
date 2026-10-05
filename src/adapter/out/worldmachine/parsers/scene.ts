import type { Scene, SceneSummary } from '../../../../domain/scene.js';
import { unexpectedOutput } from './unexpected.js';

const SHOW_HEADER = /^Scene '(.*)' \(index (\d+) of (\d+)\):$/;
const ORIGIN = /^\s+Origin \(center\):\s+(-?\d+(?:\.\d+)?), (-?\d+(?:\.\d+)?) km$/;
const SIZE = /^\s+Size:\s+(\d+(?:\.\d+)?) x (\d+(?:\.\d+)?) km$/;
const RESOLUTION = /^\s+Resolution:\s+(\d+)$/;
const LOCKED = /^\s+Locked:\s+(yes|no)$/;

export function parseSceneShow(output: readonly string[]): Scene {
  const header = SHOW_HEADER.exec(output[0]?.trim() ?? '');
  const find = (pattern: RegExp) =>
    output.map((line) => pattern.exec(line.trimEnd())).find((m) => m !== null);
  const origin = find(ORIGIN);
  const size = find(SIZE);
  const resolution = find(RESOLUTION);
  const locked = find(LOCKED);
  if (!header || header[1] === undefined || !origin || !size || !resolution || !locked) {
    throw unexpectedOutput('scene show', output);
  }
  return {
    name: header[1],
    index: Number(header[2]),
    count: Number(header[3]),
    originKm: { x: Number(origin[1]), y: Number(origin[2]) },
    sizeKm: { width: Number(size[1]), height: Number(size[2]) },
    resolution: Number(resolution[1]),
    locked: locked[1] === 'yes',
  };
}

const LIST_HEADER = /^Scenes \((\d+) total\):$/;
const LIST_ROW = /^\s+\[(\d+)\]\s+'(.*)'\s+-\s+(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?) km, res (\d+)(\s+\*)?\s*$/;

export function parseSceneList(output: readonly string[]): SceneSummary[] {
  const [header, ...rows] = output;
  const count = LIST_HEADER.exec(header?.trim() ?? '');
  if (!count) throw unexpectedOutput('scene list', output);
  const scenes = rows
    .filter((row) => row.trim() !== '' && !row.trim().startsWith('* ='))
    .map((row): SceneSummary => {
      const match = LIST_ROW.exec(row);
      if (!match || match[2] === undefined) throw unexpectedOutput('scene list', output);
      return {
        index: Number(match[1]),
        name: match[2],
        widthKm: Number(match[3]),
        heightKm: Number(match[4]),
        resolution: Number(match[5]),
        current: match[6] !== undefined,
      };
    });
  if (scenes.length !== Number(count[1])) throw unexpectedOutput('scene list', output);
  return scenes;
}
