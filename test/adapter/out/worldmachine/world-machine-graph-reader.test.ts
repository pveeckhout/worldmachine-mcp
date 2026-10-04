import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FsPathPolicy } from '../../../../src/adapter/out/fs/path-policy.js';
import { WorldMachineGraphReader } from '../../../../src/adapter/out/worldmachine/world-machine-graph-reader.js';
import { WorldMachineProcess } from '../../../../src/adapter/out/worldmachine/world-machine-process.js';
import { WorldMachineSession } from '../../../../src/adapter/out/worldmachine/world-machine-session.js';
import { captureLogger, FAKE_WM, fakeEnv, recorder } from '../../../support/fake-wm.js';

const sessions: WorldMachineSession[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.shutdown()));
});

function reader(extra: Record<string, string> = {}) {
  const record = recorder();
  const logger = captureLogger();
  const env = fakeEnv({ FAKE_WM_RECORD: record.path, ...extra });
  const session = new WorldMachineSession({
    executable: FAKE_WM,
    defaultProject: undefined,
    pathPolicy: new FsPathPolicy([mkdtempSync(join(tmpdir(), 'reader-'))]),
    commandTimeoutMs: 2_000,
    idleTimeoutMs: 0,
    logger,
    startProcess: (bin) => WorldMachineProcess.start({ bin, readyTimeoutMs: 5_000, logger, env }),
  });
  sessions.push(session);
  return { reader: new WorldMachineGraphReader(session), record };
}

describe('WorldMachineGraphReader.listDevices', () => {
  it('lists devices from World Machine', async () => {
    const devices = await reader().reader.listDevices();
    expect(devices).toHaveLength(17);
    expect(devices[0]).toEqual({ id: 1, name: 'Height Output' });
  });

  it('lists devices when a log line interrupts the output', async () => {
    expect(await reader({ FAKE_WM_INTERLEAVE: '1' }).reader.listDevices()).toHaveLength(17);
  });

  it('passes the filter as the final argument', async () => {
    const { reader: r, record } = reader();
    await r.listDevices('Height Output');
    expect(record.lines()).toContain('device list Height Output');
  });

  it('refuses a filter containing a newline before anything is sent', async () => {
    const { reader: r, record } = reader();
    await expect(r.listDevices('x\nproject close force')).rejects.toMatchObject({ code: 'REFUSED' });
    expect(record.lines()).toEqual([]);
  });
});
