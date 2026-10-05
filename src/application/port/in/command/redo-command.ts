import type { ProjectCommandView } from './project-command-view.js';

export type RedoCommand = Readonly<Record<string, never>>;
export interface RedoCommandPort {
  redo(command: RedoCommand): Promise<ProjectCommandView>;
}
