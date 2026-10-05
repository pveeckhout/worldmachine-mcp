import type { OpenProjectCommand, OpenProjectCommandPort } from '../port/in/command/open-project-command.js';
import type { ProjectCommandView } from '../port/in/command/project-command-view.js';
import type { PathPolicyPort } from '../port/out/path-policy-port.js';
import type { ProjectGraphWritePort } from '../port/out/project-graph-write-port.js';
import type { WorldMachineSessionPort } from '../port/out/world-machine-session-port.js';
import { refuseUnsavedChanges } from './project-rules.js';

export class OpenProjectService implements OpenProjectCommandPort {
  readonly #session: WorldMachineSessionPort;
  readonly #policy: PathPolicyPort;
  readonly #writer: ProjectGraphWritePort;

  constructor(session: WorldMachineSessionPort, policy: PathPolicyPort, writer: ProjectGraphWritePort) {
    this.#session = session;
    this.#policy = policy;
    this.#writer = writer;
  }

  openProject(command: OpenProjectCommand): Promise<ProjectCommandView> {
    return this.#session.exclusive(async () => {
      const path = await this.#policy.authorizeExistingProject(command.path);
      refuseUnsavedChanges(this.#session, command.discardUnsaved);
      this.#session.forgetReopen();
      await this.#writer.openProject(path);
      return { session: this.#session.status().session, path };
    });
  }
}
