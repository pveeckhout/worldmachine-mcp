import type { DeviceSummary } from './device.js';
import { foldCase, matchesListedName } from './device-name.js';

/**
 * Build-not-built design section 4: a device on the input chain of a configured output, with the ids of the devices
 * its wired inputs come from (resolved by `resolveWireSource`, fact 82).
 */
export type ChainDevice = {
  readonly id: number;
  readonly name: string;
  readonly type: string;
  readonly enabled: boolean;
  readonly bypassed: boolean;
  readonly sources: readonly number[];
};

/** Section 5, `notBuilt`: an output without a result. */
export type UnbuiltOutput = { readonly id: number; readonly name: string };

/** Section 5, `stoppedAt`: a device where building stopped. */
export type StoppedDevice = {
  readonly id: number;
  readonly name: string;
  readonly type: string;
  readonly enabled: boolean;
  readonly bypassed: boolean;
};

/** Section 5: what `build_project` adds to a full build that finished within the wait. */
export type OutputsCheck = {
  readonly outputsBuilt: boolean;
  readonly notBuilt: readonly UnbuiltOutput[];
  readonly stoppedAt: readonly StoppedDevice[];
  /** Only when `outputsBuilt` is false. */
  readonly hint?: string;
};

/** Section 5, verbatim. */
export const NOT_BUILT_HINT =
  'An output was not built. A device added from the console can be an older version that does not build; open the project in World Machine and update it in the Project Version dialog.';

/**
 * Section 4 step 1 (plan decision B3): the listed devices an `export list` name stands for. `export list` prints a
 * name whole, `device list` cuts it at 23 characters (fact 33), and names match regardless of case (fact 31), the rule
 * `WorldMachineExporter.exportingAlways` applies. Several devices may share the name (fact 30); each is returned.
 */
export function devicesNamed(name: string, devices: readonly DeviceSummary[]): DeviceSummary[] {
  return devices.filter((device) => matchesListedName(foldCase(name), foldCase(device.name)));
}

const stoppedDevice = ({ id, name, type, enabled, bypassed }: ChainDevice): StoppedDevice => ({
  id,
  name,
  type,
  enabled,
  bypassed,
});

/**
 * Section 4 step 4: the devices without a result, on the input chain of an output without a result, whose wired
 * inputs all have a result or which have no wired input. The chain is followed only through devices without a result
 * (plan decision B5). Sorted by id; each device once.
 */
export function stoppedAt(
  graph: readonly ChainDevice[],
  built: ReadonlySet<number>,
  outputs: readonly number[],
): StoppedDevice[] {
  const devices = new Map(graph.map((device) => [device.id, device]));
  const visited = new Set<number>();
  const stopped: ChainDevice[] = [];
  const visit = (id: number): void => {
    if (built.has(id) || visited.has(id)) return;
    visited.add(id);
    const device = devices.get(id);
    if (device === undefined) throw new Error(`stoppedAt: #${id} is not in the graph`);
    const unbuilt = device.sources.filter((source) => !built.has(source));
    if (unbuilt.length === 0) stopped.push(device);
    for (const source of unbuilt) visit(source);
  };
  for (const id of outputs) visit(id);
  return stopped.sort((a, b) => a.id - b.id).map(stoppedDevice);
}

/** Sections 4 step 4 and 5: `notBuilt` (sorted by id), `outputsBuilt`, `stoppedAt`, and the hint when not built. */
export function checkOutputs(
  graph: readonly ChainDevice[],
  built: ReadonlySet<number>,
  outputs: readonly number[],
): OutputsCheck {
  const devices = new Map(graph.map((device) => [device.id, device]));
  const notBuilt = [...new Set(outputs)]
    .filter((id) => !built.has(id))
    .sort((a, b) => a - b)
    .map((id): UnbuiltOutput => {
      const device = devices.get(id);
      if (device === undefined) throw new Error(`checkOutputs: output #${id} is not in the graph`);
      return { id, name: device.name };
    });
  const outputsBuilt = notBuilt.length === 0;
  return {
    outputsBuilt,
    notBuilt,
    stoppedAt: stoppedAt(graph, built, outputs),
    ...(outputsBuilt ? {} : { hint: NOT_BUILT_HINT }),
  };
}
