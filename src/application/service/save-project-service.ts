import { WorldMachineError } from '../../domain/errors.js';
import type { ProjectCommandView } from '../port/in/command/project-command-view.js';
import type { SaveProjectCommand, SaveProjectCommandPort } from '../port/in/command/save-project-command.js';
import type { PathPolicyPort } from '../port/out/path-policy-port.js';
import type { ProjectGraphWritePort } from '../port/out/project-graph-write-port.js';
import type { WorldMachineSessionPort } from '../port/out/world-machine-session-port.js';
import { requireOpenProject } from './project-rules.js';

export class SaveProjectService implements SaveProjectCommandPort {
  readonly #session: WorldMachineSessionPort;
  readonly #policy: PathPolicyPort;
  readonly #writer: ProjectGraphWritePort;

  constructor(session: WorldMachineSessionPort, policy: PathPolicyPort, writer: ProjectGraphWritePort) {
    this.#session = session;
    this.#policy = policy;
    this.#writer = writer;
  }

  saveProject(command: SaveProjectCommand): Promise<ProjectCommandView> {
    return this.#session.exclusive(async () => {
      const binding = this.#session.status().session.binding;
      const requested = command.path ?? (binding?.kind === 'opened' ? binding.path : undefined);
      if (requested === undefined) {
        throw new WorldMachineError('REFUSED', 'No path given and the project has not been saved before.');
      }
      requireOpenProject(this.#session);
      const target = await this.#policy.authorizeSaveTarget(requested);
      if (target.exists && !command.overwrite) {
        throw new WorldMachineError(
          'REFUSED',
          `${target.path} already exists. Pass overwrite: true to replace it.`,
        );
      }
      await this.#writer.saveProject(target.path, command.overwrite);
      return { session: this.#session.status().session, path: target.path };
    });
  }
}
