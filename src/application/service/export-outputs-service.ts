import type { DeviceSummary } from '../../domain/device.js';
import type {
  ExportOutputsCommand,
  ExportOutputsCommandPort,
  ExportOutputsView,
} from '../port/in/command/export-outputs-command.js';
import type { ExportPort } from '../port/out/export-port.js';
import type { PathPolicyPort } from '../port/out/path-policy-port.js';
import type { ProjectGraphReadPort } from '../port/out/project-graph-read-port.js';
import type { WorldMachineSessionPort } from '../port/out/world-machine-session-port.js';
import { checkExportTargets, type ExportCheckPorts, requireAllAllowed } from './export-rules.js';

const MATERIAL_OUTPUT = 'Material Output';
export const MATERIAL_NOTE =
  'A Material Output writes four files for its listed path: <base>_diffuse.png, <base>_disp.png, <base>_mask.png, and <base>_roughness.png.';

export class ExportOutputsService implements ExportOutputsCommandPort {
  readonly #ports: ExportCheckPorts;

  constructor(
    session: WorldMachineSessionPort,
    exports: ExportPort,
    graph: ProjectGraphReadPort,
    policy: PathPolicyPort,
  ) {
    this.#ports = { session, exports, graph, policy };
  }

  /** Inside `exclusive()`, so the session refuses it while a full or tiled build runs (spec v2a section 4). */
  exportOutputs(_command: ExportOutputsCommand): Promise<ExportOutputsView> {
    const { session, exports, graph } = this.#ports;
    return session.exclusive(async () => {
      // Read before the check and the export, so a failed read cannot hide files that were already written.
      await session.ensureRunning();
      const material = (await graph.listDevices()).some(isMaterialOutput);
      requireAllAllowed(await checkExportTargets(this.#ports, 'export'), 'an export');
      const files = await exports.exportAll();
      return { files, ...(material ? { note: MATERIAL_NOTE } : {}), session: session.status().session };
    });
  }
}

/**
 * Decision D10: a device keeps its default name `Material Output` without a kind suffix, and lists its type as the
 * kind once renamed (fact 32).
 */
function isMaterialOutput(device: DeviceSummary): boolean {
  return (device.kind ?? device.name) === MATERIAL_OUTPUT;
}
