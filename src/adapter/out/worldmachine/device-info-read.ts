import { buildCommand } from './command-builder.js';
import type { WorldMachineSession } from './world-machine-session.js';

/**
 * The first build whose `device info` takes a device reference (wm-4069/raw/help.txt l.63); build 4067's reports the
 * selected device only (wm-4067/raw/help.txt l.63).
 */
const INFO_BY_REFERENCE = 4069;

/**
 * The commands that read one device's `device info`: `device info <ref>` from build 4069, `device select <ref>` then
 * `device info` before it, or when the build is unknown. Live probes 2026-11-17 (build 4069): once a device is selected,
 * every console reply takes longer than the one before while the pointer rests on the World Machine window, up to tens
 * of seconds, and it does not recover; reads by reference select nothing. World Machine is started first, because only
 * a start reads the build (world-machine-session.ts).
 */
export async function deviceInfoCommands(session: WorldMachineSession, ref: string): Promise<string[]> {
  await session.ensureRunning();
  const build = session.status().systemInfo?.build;
  return build !== undefined && build >= INFO_BY_REFERENCE
    ? [buildCommand(['device', 'info'], ref)]
    : [buildCommand(['device', 'select'], ref), 'device info'];
}
