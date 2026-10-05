import type { ProjectCommandView } from './open-project-command.js';

export type UndoCommand = Readonly<Record<string, never>>;
export interface UndoCommandPort {
  undo(command: UndoCommand): Promise<ProjectCommandView>;
}
