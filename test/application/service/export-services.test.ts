import { describe, expect, it } from 'vitest';
import {
  ExportOutputsService,
  MATERIAL_NOTE,
} from '../../../src/application/service/export-outputs-service.js';
import { NEVER_SAVED } from '../../../src/application/service/export-rules.js';
import { ListExportsService } from '../../../src/application/service/list-exports-service.js';
import { WorldMachineError } from '../../../src/domain/errors.js';
import {
  DEFAULT_PATHS,
  DEFAULT_TARGETS,
  type ExportFakeOptions,
  exportFakes,
  SAVED,
  UNSAVED,
} from '../../support/port-fakes.js';

function listing(options: ExportFakeOptions = {}) {
  const f = exportFakes(options);
  return { ...f, service: new ListExportsService(f.session, f.exports, f.graph, f.policy) };
}

function exporting(options: ExportFakeOptions = {}) {
  const f = exportFakes(options);
  return { ...f, service: new ExportOutputsService(f.session, f.exports, f.graph, f.policy) };
}

async function failure(promise: Promise<unknown>): Promise<WorldMachineError> {
  try {
    await promise;
  } catch (error) {
    return error as WorldMachineError;
  }
  throw new Error('expected rejection');
}

describe('ListExportsService (spec v2a section 4)', () => {
  it('lists every target with its expanded, authorised path', async () => {
    const f = listing();
    expect(await f.service.listExports({})).toEqual({
      projectFolder: '/r/maps',
      targets: DEFAULT_TARGETS.map((target, index) => ({
        ...target,
        path: DEFAULT_PATHS[index],
        allowed: true,
      })),
      session: SAVED,
    });
    expect(f.calls).toEqual([
      'ensureRunning',
      'export list',
      'scene show',
      ...DEFAULT_PATHS.map((path) => `authorize ${path}`),
    ]);
  });

  it('marks every target of a project never saved as not allowed, without expanding (spec v2a section 6)', async () => {
    const f = listing({ session: UNSAVED });
    const view = await f.service.listExports({});
    expect(view.projectFolder).toBeNull();
    expect(view.targets).toEqual(
      DEFAULT_TARGETS.map((target) => ({ ...target, path: null, allowed: false, reason: NEVER_SAVED })),
    );
    expect(f.calls).toEqual(['ensureRunning', 'export list']);
  });

  it('marks a template with an unknown token as not allowed, with no path', async () => {
    const f = listing({ targets: [{ device: 'Height Output', template: '<project> <date>.png' }] });
    expect((await f.service.listExports({})).targets).toEqual([
      {
        device: 'Height Output',
        template: '<project> <date>.png',
        path: null,
        allowed: false,
        reason: 'The template uses <date>, whose value the server cannot know',
      },
    ]);
    expect(f.calls.some((call) => call.startsWith('authorize'))).toBe(false);
  });

  it('reports the path policy reason for a refused target', async () => {
    const f = listing({
      refuse: (path) => (path.includes('Splatmap') ? 'The output folder does not exist: /r/maps' : undefined),
    });
    expect((await f.service.listExports({})).targets[3]).toEqual({
      device: 'Splatmap',
      template: '<project> <name> <res>.png',
      path: '/r/maps/world Splatmap 257.png',
      allowed: false,
      reason: 'The output folder does not exist: /r/maps',
    });
  });

  it('lets NOT_CONFIGURED from the path policy through', async () => {
    const f = exportFakes();
    const service = new ListExportsService(f.session, f.exports, f.graph, {
      ...f.policy,
      authorizeOutputPath: async () => {
        throw new WorldMachineError('NOT_CONFIGURED', 'No allowed project roots');
      },
    });
    expect((await failure(service.listExports({}))).code).toBe('NOT_CONFIGURED');
  });
  it('marks an ambiguous target and a template with a .. segment as not allowed, without the ambiguous flag', async () => {
    const f = listing({
      targets: [
        { device: 'A -> B', template: 'x.png', ambiguous: true },
        { device: 'Height Output', template: '../<name>.png' },
      ],
    });
    expect((await f.service.listExports({})).targets).toEqual([
      {
        device: 'A -> B',
        template: 'x.png',
        path: null,
        allowed: false,
        reason: "The device name or the template contains ' -> ', so the target cannot be read reliably",
      },
      {
        device: 'Height Output',
        template: '../<name>.png',
        path: null,
        allowed: false,
        reason: "The template or the device name contains a '..' path segment",
      },
    ]);
    expect(f.calls.some((call) => call.startsWith('authorize'))).toBe(false);
  });
});

describe('ExportOutputsService (spec v2a section 4)', () => {
  it('checks every target, then exports inside exclusive() and notes the Material Output (fact 50)', async () => {
    const f = exporting();
    expect(await f.service.exportOutputs({})).toEqual({
      files: DEFAULT_PATHS,
      note: MATERIAL_NOTE,
      session: SAVED,
    });
    expect(f.calls).toEqual([
      'exclusive',
      'ensureRunning',
      'device list',
      'ensureRunning',
      'export list',
      'scene show',
      ...DEFAULT_PATHS.map((path) => `authorize ${path}`),
      'export all',
      'exclusive end',
    ]);
  });

  it('adds no note without a Material Output, and one for a renamed Material Output', async () => {
    const plain = exporting({ devices: [{ id: 1, name: 'Height Output', enabled: true, bypassed: false }] });
    expect(await plain.service.exportOutputs({})).toEqual({ files: DEFAULT_PATHS, session: SAVED });
    const renamed = exporting({
      devices: [{ id: 9, name: 'Coast material', kind: 'Material Output', enabled: true, bypassed: false }],
    });
    expect((await renamed.service.exportOutputs({})).note).toBe(MATERIAL_NOTE);
  });

  it('refuses a project never saved and sends no export', async () => {
    const f = exporting({ session: UNSAVED });
    const error = await failure(f.service.exportOutputs({}));
    expect(error).toMatchObject({
      code: 'REFUSED',
      message: `Save the project inside the allowed roots before an export: ${NEVER_SAVED}.`,
    });
    expect(f.calls).not.toContain('export all');
  });

  it('refuses when any target is refused, naming each one, and sends no export', async () => {
    const f = exporting({
      refuse: (path) =>
        path.includes('Height') || path.includes('Splatmap')
          ? 'The output folder does not exist: /r/maps'
          : undefined,
    });
    const error = await failure(f.service.exportOutputs({}));
    expect(error.code).toBe('REFUSED');
    expect(error.message).toBe(
      "Refused an export, because of these outputs: 'Height Output': The output folder does not exist: /r/maps; " +
        "'Splatmap': The output folder does not exist: /r/maps",
    );
    expect(f.calls).not.toContain('export all');
  });
  it('refuses an ambiguous target and a .. template, naming both, and sends no export', async () => {
    const f = exporting({
      targets: [
        { device: 'A -> B', template: 'x.png', ambiguous: true },
        { device: 'Height Output', template: '../<name>.png' },
      ],
    });
    const error = await failure(f.service.exportOutputs({}));
    expect(error.code).toBe('REFUSED');
    expect(error.message).toBe(
      "Refused an export, because of these outputs: 'A -> B': The device name or the template contains ' -> ', so the target cannot be read reliably; " +
        "'Height Output': The template or the device name contains a '..' path segment",
    );
    expect(f.calls).not.toContain('export all');
  });

  it('refuses <project> expanding to ".." in a folder, and sends no export (ruling P11-2)', async () => {
    const f = exporting({
      session: { state: 'ready', binding: { kind: 'opened', path: '/r/maps/...tmd' }, dirty: false },
      targets: [{ device: 'Height Output', template: 'link/<project>/<name>.png' }],
    });
    const error = await failure(f.service.exportOutputs({}));
    expect(error.message).toBe(
      "Refused an export, because of these outputs: 'Height Output': The expanded path contains a '.' or '..' segment",
    );
    expect(f.calls).not.toContain('export all');
  });
});
