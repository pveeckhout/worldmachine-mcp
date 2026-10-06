import { describe, expect, it } from 'vitest';
import type { SnapshotPort } from '../../../src/application/port/out/snapshot-port.js';
import type { WorldMachineSessionPort } from '../../../src/application/port/out/world-machine-session-port.js';
import { CreateSnapshotService } from '../../../src/application/service/create-snapshot-service.js';
import { DeleteSnapshotService } from '../../../src/application/service/delete-snapshot-service.js';
import { ListSnapshotsService } from '../../../src/application/service/list-snapshots-service.js';
import { RestoreSnapshotService } from '../../../src/application/service/restore-snapshot-service.js';
import { WorldMachineError } from '../../../src/domain/errors.js';
import type { SessionSummary } from '../../../src/domain/session.js';

const READY_DIRTY: SessionSummary = { state: 'ready', binding: { kind: 'fresh' }, dirty: true };
const A = { index: 0, name: 'erosion-a', created: '2026-10-06 11:09' };
const B = { index: 1, name: 'erosion-b', created: '2026-10-06 11:10' };

function fakes() {
  const calls: string[] = [];
  const session: WorldMachineSessionPort = {
    ensureRunning: async () => {},
    status: () => ({ executable: '/wm', session: READY_DIRTY }),
    shutdown: async () => {},
    forgetReopen: () => undefined,
    exclusive: (action) => {
      calls.push('exclusive:start');
      return action().finally(() => void calls.push('exclusive:end'));
    },
  };
  const snapshots: SnapshotPort = {
    list: async () => {
      calls.push('list');
      return [A, B];
    },
    create: async (name) => {
      calls.push(`create:${name}`);
      return { index: 2, name, created: '2026-10-06 11:11' };
    },
    restore: async (snapshot) => {
      calls.push(`restore:${snapshot}`);
      return A;
    },
    remove: async (snapshot) => {
      calls.push(`remove:${snapshot}`);
      return { deleted: A, remaining: [{ ...B, index: 0 }] };
    },
  };
  return { calls, session, snapshots };
}

const inExclusive = (call: string) => ['exclusive:start', call, 'exclusive:end'];

describe('snapshot services (spec v2b section 3)', () => {
  it('ListSnapshotsService lists outside exclusive, so it works during a build', async () => {
    const f = fakes();
    expect(await new ListSnapshotsService(f.session, f.snapshots).listSnapshots({})).toEqual({
      snapshots: [A, B],
      session: READY_DIRTY,
    });
    expect(f.calls).toEqual(['list']);
  });

  it('CreateSnapshotService creates inside exclusive and returns the new snapshot', async () => {
    const f = fakes();
    expect(
      await new CreateSnapshotService(f.session, f.snapshots).createSnapshot({ name: 'erosion-c' }),
    ).toEqual({
      index: 2,
      name: 'erosion-c',
      created: '2026-10-06 11:11',
      session: READY_DIRTY,
    });
    expect(f.calls).toEqual(inExclusive('create:erosion-c'));
  });

  it('RestoreSnapshotService restores inside exclusive and returns the index and name only', async () => {
    const f = fakes();
    expect(
      await new RestoreSnapshotService(f.session, f.snapshots).restoreSnapshot({ snapshot: 'erosion-a' }),
    ).toEqual({ index: 0, name: 'erosion-a', session: READY_DIRTY });
    expect(f.calls).toEqual(inExclusive('restore:erosion-a'));
  });

  it('DeleteSnapshotService deletes inside exclusive and returns the remaining snapshots', async () => {
    const f = fakes();
    expect(
      await new DeleteSnapshotService(f.session, f.snapshots).deleteSnapshot({ snapshot: '#0' }),
    ).toEqual({
      index: 0,
      name: 'erosion-a',
      remaining: [{ index: 0, name: 'erosion-b', created: '2026-10-06 11:10' }],
      session: READY_DIRTY,
    });
    expect(f.calls).toEqual(inExclusive('remove:#0'));
  });

  it('builds each view field by field, so a port result with an extra field stays out of it', async () => {
    const f = fakes();
    const extra = { ...A, extra: 1 };
    const loose: SnapshotPort = {
      ...f.snapshots,
      create: async () => extra,
      restore: async () => extra,
      remove: async () => ({ deleted: extra, remaining: [] }),
    };
    expect(
      await new CreateSnapshotService(f.session, loose).createSnapshot({ name: 'x' }),
    ).not.toHaveProperty('extra');
    expect(await new RestoreSnapshotService(f.session, loose).restoreSnapshot({ snapshot: 'x' })).toEqual({
      index: 0,
      name: 'erosion-a',
      session: READY_DIRTY,
    });
    expect(
      await new DeleteSnapshotService(f.session, loose).deleteSnapshot({ snapshot: 'x' }),
    ).not.toHaveProperty('extra');
  });

  it('propagates a refusal and still leaves the exclusive section', async () => {
    const f = fakes();
    const refusing: SnapshotPort = {
      ...f.snapshots,
      restore: async () => {
        throw new WorldMachineError('REFUSED', "The snapshot name 'A' matches #0, #2; use #<index>");
      },
    };
    await expect(
      new RestoreSnapshotService(f.session, refusing).restoreSnapshot({ snapshot: 'A' }),
    ).rejects.toMatchObject({ code: 'REFUSED' });
    expect(f.calls).toEqual(['exclusive:start', 'exclusive:end']);
  });
});
