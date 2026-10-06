import type { ExportPort } from '../../src/application/port/out/export-port.js';
import type { PathPolicyPort } from '../../src/application/port/out/path-policy-port.js';
import type { ProjectGraphReadPort } from '../../src/application/port/out/project-graph-read-port.js';
import type { WorldMachineSessionPort } from '../../src/application/port/out/world-machine-session-port.js';
import type { DeviceSummary } from '../../src/domain/device.js';
import { WorldMachineError } from '../../src/domain/errors.js';
import type { ExportTarget } from '../../src/domain/output-template.js';
import type { Scene } from '../../src/domain/scene.js';
import type { SessionSummary } from '../../src/domain/session.js';

/** A project saved as /r/maps/world.tmd (the binding `export all` resolves templates against, fact 50). */
export const SAVED: SessionSummary = {
  state: 'ready',
  binding: { kind: 'opened', path: '/r/maps/world.tmd' },
  dirty: false,
};
export const UNSAVED: SessionSummary = { state: 'ready', binding: { kind: 'fresh' }, dirty: false };

// raw/v2-build-export.txt l.15-20.
export const DEFAULT_TARGETS: readonly ExportTarget[] = [
  { device: 'Height Output', template: '<project> <name>-<res>.png' },
  { device: 'Material Output', template: '<project> <name> <res>.png' },
  { device: 'Colormap only', template: '<project> <name> <res>.png' },
  { device: 'Splatmap', template: '<project> <name> <res>.png' },
];

export const DEFAULT_PATHS = [
  '/r/maps/world Height Output-257.png',
  '/r/maps/world Material Output 257.png',
  '/r/maps/world Colormap only 257.png',
  '/r/maps/world Splatmap 257.png',
];

const SCENE_257: Scene = {
  name: 'Main Extents',
  index: 0,
  count: 1,
  originKm: { x: 4, y: 4 },
  sizeKm: { width: 12, height: 12 },
  resolution: 257,
  locked: false,
};

// raw/v2-build-export.txt l.47 and l.52: the default project's Material Output and a renamed Bitmap Output.
const DEFAULT_DEVICES: readonly DeviceSummary[] = [
  { id: 1, name: 'Height Output', enabled: true, bypassed: false },
  { id: 308, name: 'Material Output', enabled: true, bypassed: false },
  { id: 318, name: 'Splatmap', kind: 'Bitmap Output', enabled: true, bypassed: false },
];

export type ExportFakeOptions = {
  readonly session?: SessionSummary;
  readonly targets?: readonly ExportTarget[];
  /** The canonical path the policy returns for an allowed path (a symlinked root); the path itself by default. */
  readonly canonical?: (path: string) => string;
  /** A REFUSED reason for a path, or undefined to allow it. */
  readonly refuse?: (path: string) => string | undefined;
  readonly devices?: readonly DeviceSummary[];
  /** Devices whose `exportAlways` is not confirmed off (fact 55, ruling P-FR-3). */
  readonly exportAlways?: readonly string[];
};

/**
 * In-memory session, export, graph, and path-policy ports for the export and build services. Every call is recorded
 * in `calls`; `exclusive` records its start and its end, so a test can tell what ran inside it.
 */
export function exportFakes(options: ExportFakeOptions = {}) {
  const calls: string[] = [];
  const session: WorldMachineSessionPort = {
    ensureRunning: async () => void calls.push('ensureRunning'),
    status: () => ({ executable: '/wm', session: options.session ?? SAVED }),
    shutdown: async () => undefined,
    forgetReopen: () => undefined,
    exclusive: async (action) => {
      calls.push('exclusive');
      try {
        return await action();
      } finally {
        calls.push('exclusive end');
      }
    },
  };
  const exports: ExportPort = {
    targets: async () => {
      calls.push('export list');
      return [...(options.targets ?? DEFAULT_TARGETS)];
    },
    exportAll: async () => {
      calls.push('export all');
      return [...DEFAULT_PATHS];
    },
    exportingAlways: async (devices) => {
      calls.push(`exportAlways ${devices.join(', ')}`);
      return devices.filter((device) => options.exportAlways?.includes(device));
    },
  };
  const unused = async (): Promise<never> => {
    throw new Error('not used by these services');
  };
  const graph: ProjectGraphReadPort = {
    listDevices: async () => {
      calls.push('device list');
      return [...(options.devices ?? DEFAULT_DEVICES)];
    },
    getDevice: unused,
    getScene: async () => {
      calls.push('scene show');
      return SCENE_257;
    },
    inspectProject: unused,
  };
  const policy: PathPolicyPort = {
    authorizeExistingProject: unused,
    authorizeSaveTarget: unused,
    authorizeOutputPath: async (path) => {
      calls.push(`authorize ${path}`);
      const reason = options.refuse?.(path);
      if (reason !== undefined) throw new WorldMachineError('REFUSED', reason);
      return options.canonical?.(path) ?? path;
    },
  };
  return { calls, session, exports, graph, policy };
}
