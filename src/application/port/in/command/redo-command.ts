import type { ProjectCommandView } from './open-project-command.js';

export type RedoCommand = Readonly<Record<string, never>>;
export interface RedoCommandPort {
  redo(command: RedoCommand): Promise<ProjectCommandView>;
}
