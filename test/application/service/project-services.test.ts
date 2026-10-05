import { describe, expect, it } from 'vitest';
import type { PathPolicyPort, SaveTarget } from '../../../src/application/port/out/path-policy-port.js';
import type { ProjectGraphWritePort } from '../../../src/application/port/out/project-graph-write-port.js';
import type { WorldMachineSessionPort } from '../../../src/application/port/out/world-machine-session-port.js';
import { CreateProjectService } from '../../../src/application/service/create-project-service.js';
import { OpenProjectService } from '../../../src/application/service/open-project-service.js';
import { RedoService } from '../../../src/application/service/redo-service.js';
import { SaveProjectService } from '../../../src/application/service/save-project-service.js';
import { UndoService } from '../../../src/application/service/undo-service.js';
import type { SessionSummary } from '../../../src/domain/session.js';

function fakes(session: SessionSummary, target: SaveTarget = { path: '/r/x.tmd', exists: false }) {
  const calls: string[] = [];
  const sessionPort: WorldMachineSessionPort = {
    ensureRunning: async () => {},
    status: () => ({ executable: '/wm', session }),
    shutdown: async () => {},
    forgetReopen: () => void calls.push('forget'),
    exclusive: (action) => {
      calls.push('exclusive');
      return action();
    },
  };
  const policy: PathPolicyPort = {
    authorizeExistingProject: async (p) => {
      calls.push(`authorize:${p}`);
      return `/canon${p}`;
    },
    authorizeSaveTarget: async (p) => {
      calls.push(`target:${p}`);
      return target;
    },
  };
  const writer: ProjectGraphWritePort = {
    openProject: async (p) => void calls.push(`open:${p}`),
    createProject: async () => void calls.push('create'),
    saveProject: async (p, allowReplace) => void calls.push(`save:${p}:${allowReplace}`),
    undo: async () => void calls.push('undo'),
    redo: async () => void calls.push('redo'),
  };
  return { calls, sessionPort, policy, writer };
}

const READY_CLEAN: SessionSummary = { state: 'ready', binding: { kind: 'fresh' }, dirty: false };
const READY_DIRTY: SessionSummary = {
  state: 'ready',
  binding: { kind: 'opened', path: '/r/a.tmd' },
  dirty: true,
};

describe('OpenProjectService', () => {
  it('authorises, then opens the canonical path', async () => {
    const f = fakes(READY_CLEAN);
    const view = await new OpenProjectService(f.sessionPort, f.policy, f.writer).openProject({
      path: '/r/b.tmd',
      discardUnsaved: false,
    });
    expect(f.calls).toEqual(['exclusive', 'authorize:/r/b.tmd', 'forget', 'open:/canon/r/b.tmd']);
    expect(view).toEqual({ session: READY_CLEAN, path: '/canon/r/b.tmd' });
  });

  it('refuses to open over unsaved changes without discard_unsaved', async () => {
    const f = fakes(READY_DIRTY);
    await expect(
      new OpenProjectService(f.sessionPort, f.policy, f.writer).openProject({
        path: '/r/b.tmd',
        discardUnsaved: false,
      }),
    ).rejects.toMatchObject({ code: 'REFUSED' });
    expect(f.calls).toEqual(['exclusive', 'authorize:/r/b.tmd']);
  });

  it('opens over unsaved changes with discard_unsaved', async () => {
    const f = fakes(READY_DIRTY);
    await new OpenProjectService(f.sessionPort, f.policy, f.writer).openProject({
      path: '/r/b.tmd',
      discardUnsaved: true,
    });
    expect(f.calls).toContain('open:/canon/r/b.tmd');
  });
});

describe('CreateProjectService', () => {
  it('refuses over unsaved changes, creates otherwise', async () => {
    const dirty = fakes(READY_DIRTY);
    await expect(
      new CreateProjectService(dirty.sessionPort, dirty.writer).createProject({ discardUnsaved: false }),
    ).rejects.toMatchObject({
      code: 'REFUSED',
    });
    expect(dirty.calls).toEqual(['exclusive']);
    const clean = fakes({ state: 'notRunning' });
    await new CreateProjectService(clean.sessionPort, clean.writer).createProject({ discardUnsaved: false });
    expect(clean.calls).toEqual(['exclusive', 'forget', 'create']);
  });
});

describe('SaveProjectService', () => {
  it('saves to the opened path when no path is given, with overwrite', async () => {
    const f = fakes(READY_DIRTY, { path: '/r/a.tmd', exists: true });
    const view = await new SaveProjectService(f.sessionPort, f.policy, f.writer).saveProject({
      overwrite: true,
    });
    expect(f.calls).toEqual(['exclusive', 'target:/r/a.tmd', 'save:/r/a.tmd:true']);
    expect(view.path).toBe('/r/a.tmd');
  });

  it('refuses to replace an existing file without overwrite', async () => {
    const f = fakes(READY_CLEAN, { path: '/r/x.tmd', exists: true });
    await expect(
      new SaveProjectService(f.sessionPort, f.policy, f.writer).saveProject({
        path: '/r/x.tmd',
        overwrite: false,
      }),
    ).rejects.toMatchObject({
      code: 'REFUSED',
      message: '/r/x.tmd already exists. Pass overwrite: true to replace it.',
    });
    expect(f.calls).toEqual(['exclusive', 'target:/r/x.tmd']);
  });

  it('refuses without a path when the project was never saved', async () => {
    const f = fakes(READY_CLEAN);
    await expect(
      new SaveProjectService(f.sessionPort, f.policy, f.writer).saveProject({ overwrite: false }),
    ).rejects.toMatchObject({
      code: 'REFUSED',
    });
    expect(f.calls).toEqual(['exclusive']);
  });

  it('refuses when World Machine is not running', async () => {
    const f = fakes({ state: 'notRunning' });
    await expect(
      new SaveProjectService(f.sessionPort, f.policy, f.writer).saveProject({
        path: '/r/x.tmd',
        overwrite: false,
      }),
    ).rejects.toMatchObject({ code: 'REFUSED', message: 'No project is open in World Machine.' });
    expect(f.calls).toEqual(['exclusive']);
  });
});

describe('UndoService and RedoService', () => {
  it('refuse when World Machine is not running and run otherwise', async () => {
    const idle = fakes({ state: 'notRunning' });
    await expect(new UndoService(idle.sessionPort, idle.writer).undo({})).rejects.toMatchObject({
      code: 'REFUSED',
    });
    await expect(new RedoService(idle.sessionPort, idle.writer).redo({})).rejects.toMatchObject({
      code: 'REFUSED',
    });
    const ready = fakes(READY_CLEAN);
    await new UndoService(ready.sessionPort, ready.writer).undo({});
    await new RedoService(ready.sessionPort, ready.writer).redo({});
    expect(ready.calls).toEqual(['exclusive', 'undo', 'exclusive', 'redo']);
  });
});
