import type { ProjectCommandView } from './project-command-view.js';

export type SaveProjectCommand = { readonly path?: string; readonly overwrite: boolean };
export interface SaveProjectCommandPort {
  saveProject(command: SaveProjectCommand): Promise<ProjectCommandView>;
}
