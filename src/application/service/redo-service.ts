import type { ProjectCommandView } from '../port/in/command/project-command-view.js';
import type { RedoCommand, RedoCommandPort } from '../port/in/command/redo-command.js';
import type { ProjectGraphWritePort } from '../port/out/project-graph-write-port.js';
import type { WorldMachineSessionPort } from '../port/out/world-machine-session-port.js';
import { requireOpenProject } from './project-rules.js';

export class RedoService implements RedoCommandPort {
  readonly #session: WorldMachineSessionPort;
  readonly #writer: ProjectGraphWritePort;

  constructor(session: WorldMachineSessionPort, writer: ProjectGraphWritePort) {
    this.#session = session;
    this.#writer = writer;
  }

  redo(_command: RedoCommand): Promise<ProjectCommandView> {
    return this.#session.exclusive(async () => {
      requireOpenProject(this.#session);
      await this.#writer.redo();
      return { session: this.#session.status().session };
    });
  }
}
