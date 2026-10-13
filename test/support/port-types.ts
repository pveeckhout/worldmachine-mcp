import {
  type PortTypeCatalog,
  WorldMachinePortTypes,
} from '../../src/adapter/out/worldmachine/world-machine-port-types.js';
import type { SessionStatus } from '../../src/application/port/out/world-machine-session-port.js';

/** raw/system-info.txt l.3-4, as WorldMachineSession.status() holds it. */
export const SYSTEM_INFO = { build: 4067, buildName: 'Dragontail Peak', arch: 'x64-AVX2 (256-bit)' };

/** A session whose status reports World Machine `build`, or holds no system info. */
export const statusOn = (build: number | undefined) => ({
  status: (): SessionStatus => ({
    executable: null,
    session: { state: 'ready', binding: { kind: 'fresh' }, dirty: false },
    ...(build === undefined ? {} : { systemInfo: { ...SYSTEM_INFO, build } }),
  }),
});

/**
 * Synthetic (port-types plan decisions D1 and D3): no port-type capture exists before plan Task 11. Ports as captured:
 * Gradient raw/p2a-edge-cases.txt l.38-42, Combiner raw/p2b-graph-edits.txt l.121-126, Create Water
 * raw/create-water.txt l.122-133, Height Output raw/river-build-diag.txt l.38-43; VDM Features is what `device add
 * Anisotropy` adds (raw/v3-rename-types.txt l.23-24), its ports invented. The add words are those phase A of
 * raw/v3-rename-types.txt accepted for each type (l.23-24, l.168-169, l.204-205, l.237-238, and l.603-604; Codex
 * round 1 ruling B1 and addendum). The classes follow the captured verdicts where they exist: Create Water's Existing
 * Water refuses a Gradient (raw/create-water-sea.txt l.194-195) and takes a Water System (l.276-277), and a Height
 * Output takes Create Water's Terrain (l.113-114). The class names and every other verdict are invented for tests.
 */
export const SYNTHETIC_CATALOG: PortTypeCatalog = {
  build: 4067,
  outputClasses: { o1: 'heightfield', o2: 'water system' },
  inputClasses: { i1: ['o1'], i2: ['o2'], i3: [] },
  types: {
    Gradient: {
      added: ['Gradient'],
      inputs: [],
      outputs: [{ port: 1, name: 'Primary Output', class: 'o1' }],
    },
    Combiner: {
      added: ['Combiner'],
      inputs: [
        { port: 1, name: 'Primary Input', class: 'i1' },
        { port: 2, name: 'Primary Input', class: 'i1' },
      ],
      outputs: [{ port: 1, name: 'Primary Output', class: 'o1' }],
    },
    'Create Water': {
      added: ['Create Water'],
      inputs: [
        { port: 1, name: 'Terrain', class: 'i1' },
        { port: 2, name: 'Existing Water', class: 'i2' },
        { port: 3, name: 'Precipitation Map', class: 'i1' },
      ],
      outputs: [
        { port: 1, name: 'Terrain', class: 'o1' },
        { port: 2, name: 'Water System', class: 'o2' },
        { port: 3, name: 'Tributary Mask', class: 'o1' },
        { port: 4, name: 'Lake Mask', class: 'o1' },
      ],
    },
    'Height Output': {
      added: ['File Output', 'Height Output'],
      inputs: [
        { port: 1, name: 'Primary Input', class: 'i1' },
        { port: 2, name: 'Metadata Input', class: 'i3' },
      ],
      outputs: [],
    },
    'VDM Features': {
      added: ['Anisotropy', 'Displacement', 'Height', 'Twist'],
      inputs: [{ port: 1, name: 'Primary Input', class: 'i1' }],
      outputs: [{ port: 1, name: 'Primary Output', class: 'o1' }],
    },
  },
};

/** SYNTHETIC_CATALOG with World Machine reporting its build. */
export const syntheticPortTypes = new WorldMachinePortTypes(statusOn(4067), SYNTHETIC_CATALOG);
