import type { ProjectCommandView } from './project-command-view.js';

export type UndoCommand = Readonly<Record<string, never>>;
export interface UndoCommandPort {
  undo(command: UndoCommand): Promise<ProjectCommandView>;
}
