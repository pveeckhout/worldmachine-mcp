import { describe, expect, it } from 'vitest';
import {
  type ChainDevice,
  checkOutputs,
  devicesNamed,
  NOT_BUILT_HINT,
  stoppedAt,
} from '../../src/domain/build-result.js';
import type { DeviceSummary } from '../../src/domain/device.js';

const chain = (id: number, name: string, sources: number[] = [], state: Partial<ChainDevice> = {}) =>
  ({ id, name, type: name, enabled: true, bypassed: false, sources, ...state }) satisfies ChainDevice;
const shown = ({ id, name, type, enabled, bypassed }: ChainDevice) => ({ id, name, type, enabled, bypassed });
const listed = (id: number, name: string): DeviceSummary => ({ id, name, enabled: true, bypassed: false });

// raw/build-not-built-timing.txt l.1-46 and l.72-90 (fact 93): Gradient into River into File Output.
const GRADIENT = chain(1, 'Gradient');
const RIVER = chain(2, 'River', [1]);
const OUTPUT = chain(3, 'Height Output', [2]);

describe('stoppedAt (build-not-built design section 4)', () => {
  it('stops a chain at its middle device, the River (fact 93)', () => {
    expect(stoppedAt([OUTPUT, RIVER, GRADIENT], new Set([1]), [3])).toEqual([shown(RIVER)]);
  });

  it('lists the unbuilt branch of a device whose other branch built', () => {
    const river = chain(2, 'River', [3]);
    const graph = [
      chain(5, 'Height Output', [4]),
      chain(4, 'Combiner', [1, 2]),
      GRADIENT,
      river,
      chain(3, 'Perlin'),
    ];
    expect(stoppedAt(graph, new Set([1, 3]), [5])).toEqual([shown(river)]);
  });

  it('never lists a device that no unbuilt output needs', () => {
    const graph = [
      OUTPUT,
      RIVER,
      GRADIENT,
      chain(6, 'Inverter'),
      chain(8, 'Splatmap', [7]),
      chain(7, 'Inverter'),
    ];
    // #6 feeds nothing; #7 feeds #8, an output with a result.
    expect(stoppedAt(graph, new Set([1, 2, 3, 8]), [3, 8])).toEqual([]);
  });

  it('stops at an unbuilt output whose inputs all built, never above a device that built (plan decision B5)', () => {
    const output = chain(3, 'Height Output', [2]);
    expect(stoppedAt([output, chain(2, 'Curves', [1]), chain(1, 'River')], new Set([2]), [3])).toEqual([
      shown(output),
    ]);
  });

  it('lists an unbuilt device without wired inputs', () => {
    expect(stoppedAt([chain(2, 'Height Output', [1]), GRADIENT], new Set(), [2])).toEqual([shown(GRADIENT)]);
  });

  it('lists a device once when it stops two outputs and two paths (raw/river-failing-graph.txt l.144-148)', () => {
    const river = chain(538, 'River');
    const outputs = [chain(536, 'Height Output', [538]), chain(537, 'Height Output', [538])];
    expect(stoppedAt([...outputs, river], new Set(), [536, 537])).toEqual([shown(river)]);
    const source = chain(1, 'Gradient');
    const diamond = [chain(5, 'Height Output', [4]), chain(4, 'Combiner', [2, 3]), chain(2, 'Curves', [1])];
    expect(stoppedAt([...diamond, chain(3, 'Terrace', [1]), source], new Set(), [5])).toEqual([
      shown(source),
    ]);
  });

  it('reports the state of a stopped device as read', () => {
    const river = chain(2, 'River', [1], { enabled: false, bypassed: true });
    expect(stoppedAt([OUTPUT, river, GRADIENT], new Set([1]), [3])).toEqual([
      { id: 2, name: 'River', type: 'River', enabled: false, bypassed: true },
    ]);
  });

  it('returns nothing without outputs', () => {
    expect(stoppedAt([], new Set(), [])).toEqual([]);
  });
});

describe('checkOutputs (build-not-built design sections 4 and 5)', () => {
  it('reports the River graph: not built, its output, the River, and the hint', () => {
    expect(checkOutputs([OUTPUT, RIVER, GRADIENT], new Set([1]), [3])).toEqual({
      outputsBuilt: false,
      notBuilt: [{ id: 3, name: 'Height Output' }],
      stoppedAt: [shown(RIVER)],
      hint: NOT_BUILT_HINT,
    });
  });

  it('reports Gradient into File Output as built, without a hint (raw/build-not-built-timing.txt l.167-181)', () => {
    expect(checkOutputs([chain(2, 'Height Output', [1]), GRADIENT], new Set([1, 2]), [2])).toEqual({
      outputsBuilt: true,
      notBuilt: [],
      stoppedAt: [],
    });
  });

  it('reports no outputs as built (section 4 step 1)', () => {
    expect(checkOutputs([], new Set(), [])).toEqual({ outputsBuilt: true, notBuilt: [], stoppedAt: [] });
  });

  it('lists each unbuilt output of a shared name, by id', () => {
    const graph = [
      chain(537, 'Height Output', [538]),
      chain(536, 'Height Output', [538]),
      chain(538, 'River'),
    ];
    expect(checkOutputs(graph, new Set(), [537, 536]).notBuilt).toEqual([
      { id: 536, name: 'Height Output' },
      { id: 537, name: 'Height Output' },
    ]);
  });

  it('carries the hint text of spec section 5', () => {
    expect(NOT_BUILT_HINT).toBe(
      'An output was not built. A device added from the console can be an older version that does not build; open the project in World Machine and update it in the Project Version dialog.',
    );
  });
});

describe('devicesNamed (build-not-built design section 4 step 1)', () => {
  it('matches every device of a shared name (raw/river-failing-graph.txt l.59-60)', () => {
    const devices = [listed(536, 'Height Output'), listed(537, 'Height Output'), listed(538, 'River')];
    expect(devicesNamed('Height Output', devices).map((device) => device.id)).toEqual([536, 537]);
  });

  it('matches regardless of case (fact 31)', () => {
    expect(devicesNamed('height OUTPUT', [listed(1, 'Height Output')]).map((device) => device.id)).toEqual([
      1,
    ]);
  });

  it('matches a name printed whole to its 23-character listing (fact 33, assumption A3)', () => {
    const devices = [listed(4, 'Height Output for the c')];
    expect(devicesNamed('Height Output for the coast', devices).map((device) => device.id)).toEqual([4]);
  });

  it('matches nothing for a name no device has', () => {
    expect(devicesNamed('Splatmap', [listed(1, 'Height Output')])).toEqual([]);
  });
});
