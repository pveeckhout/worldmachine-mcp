import type {
  CreateProjectCommand,
  CreateProjectCommandPort,
} from '../port/in/command/create-project-command.js';
import type { ProjectCommandView } from '../port/in/command/open-project-command.js';
import type { ProjectGraphWritePort } from '../port/out/project-graph-write-port.js';
import type { WorldMachineSessionPort } from '../port/out/world-machine-session-port.js';
import { refuseUnsavedChanges } from './project-rules.js';

export class CreateProjectService implements CreateProjectCommandPort {
  readonly #session: WorldMachineSessionPort;
  readonly #writer: ProjectGraphWritePort;

  constructor(session: WorldMachineSessionPort, writer: ProjectGraphWritePort) {
    this.#session = session;
    this.#writer = writer;
  }

  createProject(command: CreateProjectCommand): Promise<ProjectCommandView> {
    return this.#session.exclusive(async () => {
      refuseUnsavedChanges(this.#session, command.discardUnsaved);
      await this.#writer.createProject();
      return { session: this.#session.status().session };
    });
  }
}
