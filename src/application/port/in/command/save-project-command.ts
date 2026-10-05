import type { ProjectCommandView } from './open-project-command.js';

export type SaveProjectCommand = { readonly path?: string; readonly overwrite: boolean };
export interface SaveProjectCommandPort {
  saveProject(command: SaveProjectCommand): Promise<ProjectCommandView>;
}
