import type { ProjectCommandView } from '../port/in/command/open-project-command.js';
import type { UndoCommand, UndoCommandPort } from '../port/in/command/undo-command.js';
import type { ProjectGraphWritePort } from '../port/out/project-graph-write-port.js';
import type { WorldMachineSessionPort } from '../port/out/world-machine-session-port.js';
import { requireOpenProject } from './project-rules.js';

export class UndoService implements UndoCommandPort {
  readonly #session: WorldMachineSessionPort;
  readonly #writer: ProjectGraphWritePort;

  constructor(session: WorldMachineSessionPort, writer: ProjectGraphWritePort) {
    this.#session = session;
    this.#writer = writer;
  }

  undo(_command: UndoCommand): Promise<ProjectCommandView> {
    return this.#session.exclusive(async () => {
      requireOpenProject(this.#session);
      await this.#writer.undo();
      return { session: this.#session.status().session };
    });
  }
}
