import { describe, expect, it, vi } from 'vitest';
import type { BuildResultPort } from '../../../src/application/port/out/build-result-port.js';
import type { WorldMachineSessionPort } from '../../../src/application/port/out/world-machine-session-port.js';
import { OutputsChecker } from '../../../src/application/service/outputs-checker.js';
import { NOT_BUILT_HINT } from '../../../src/domain/build-result.js';
import type { DeviceDetail } from '../../../src/domain/device.js';
import { WorldMachineError } from '../../../src/domain/errors.js';
import { exportFakes } from '../../support/port-fakes.js';

// raw/v2-build-export.txt l.15-20: the default project's Height Output, read here without inputs.
const HEIGHT_OUTPUT: DeviceDetail = {
  id: 1,
  name: 'Height Output',
  type: 'Height Output',
  enabled: true,
  bypassed: false,
  parameters: [],
  inputs: [],
  outputs: [],
};

/** One configured output, #1, built when `built` lists it; `built` as an Error is thrown by the timing read. */
function checking(built: readonly number[] | Error = [1]) {
  const f = exportFakes({
    targets: [{ device: 'Height Output', template: '<project> <name>-<res>.png' }],
    devices: [{ id: 1, name: 'Height Output', enabled: true, bypassed: false }],
    details: [HEIGHT_OUTPUT],
  });
  const results: BuildResultPort = {
    builtDevices: async (ids) => {
      f.calls.push(`devicetiming ${ids.map((id) => `#${id}`).join(', ')}`);
      if (built instanceof Error) throw built;
      return ids.filter((id) => built.includes(id));
    },
  };
  return { ...f, results, checker: new OutputsChecker(f.session, f.exports, f.graph, results) };
}

describe('OutputsChecker (build-status-check design section 4)', () => {
  it("runs build_project's check in its own exclusive() section", async () => {
    const f = checking([]);
    expect(await f.checker.check()).toEqual({
      outputsBuilt: false,
      notBuilt: [{ id: 1, name: 'Height Output' }],
      stoppedAt: [{ id: 1, name: 'Height Output', type: 'Height Output', enabled: true, bypassed: false }],
      hint: NOT_BUILT_HINT,
    });
    expect(f.calls).toEqual([
      'exclusive',
      'export list',
      'device list',
      'devicetiming #1',
      'device info #1',
      'exclusive end',
    ]);
  });

  it('reports a WorldMachineError as outputsCheckError (build-not-built design section 6)', async () => {
    const f = checking(new WorldMachineError('TIMEOUT', 'World Machine did not answer'));
    expect(await f.checker.check()).toEqual({ outputsCheckError: 'World Machine did not answer' });
  });

  it('lets an error that is no WorldMachineError propagate', async () => {
    await expect(checking(new Error('a bug')).checker.check()).rejects.toThrow('a bug');
  });

  it('checks when the guard lets it read (plan decision D7)', async () => {
    const f = checking();
    expect(await f.checker.checkGuarded(() => undefined)).toEqual({
      kind: 'checked',
      outcome: { outputsBuilt: true, notBuilt: [], stoppedAt: [] },
    });
  });

  it('runs the guard first inside the section and returns its value without reads when it stops the check (plan decision D7)', async () => {
    const f = checking();
    expect(await f.checker.checkGuarded(() => 'stopped here')).toEqual({
      kind: 'stopped',
      value: 'stopped here',
    });
    expect(f.calls).toEqual(['exclusive', 'exclusive end']);
  });

  it('reports a WorldMachineError of the reads as the outcome of a guarded check', async () => {
    const f = checking(new WorldMachineError('TIMEOUT', 'World Machine did not answer'));
    expect(await f.checker.checkGuarded(() => undefined)).toEqual({
      kind: 'checked',
      outcome: { outputsCheckError: 'World Machine did not answer' },
    });
  });

  it('reports a refused exclusive() section as refused, without running the guard (Codex round 2 ruling 1b)', async () => {
    const f = checking();
    const refusing: WorldMachineSessionPort = {
      ...f.session,
      exclusive: async () => {
        throw new WorldMachineError(
          'REFUSED',
          'A build is running; call stop_build or wait for it to finish',
        );
      },
    };
    const guard = vi.fn(() => undefined);
    const checker = new OutputsChecker(refusing, f.exports, f.graph, f.results);
    expect(await checker.checkGuarded(guard)).toEqual({ kind: 'refused' });
    expect(guard).not.toHaveBeenCalled();
  });
});
