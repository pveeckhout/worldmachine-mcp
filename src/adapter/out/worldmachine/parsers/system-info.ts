import type { SystemInfo } from '../../../../domain/system-info.js';
import { unexpectedOutput } from './unexpected.js';

const VERSION = /^\s*Version:\s+Build (\d+) '([^']*)'\s*$/;
const ARCH = /^\s*Arch:\s+(.+?)\s*$/;

export function parseSystemInfo(output: readonly string[]): SystemInfo {
  let build: number | undefined;
  let buildName: string | undefined;
  let arch: string | undefined;
  for (const line of output) {
    const version = VERSION.exec(line);
    if (version) {
      build = Number(version[1]);
      buildName = version[2];
    }
    const archMatch = ARCH.exec(line);
    if (archMatch) arch = archMatch[1];
  }
  if (build === undefined || buildName === undefined || arch === undefined) {
    throw unexpectedOutput('system info', output);
  }
  return { build, buildName, arch };
}
