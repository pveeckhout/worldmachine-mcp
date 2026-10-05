import type { ProjectCommandView } from './project-command-view.js';

export type OpenProjectCommand = { readonly path: string; readonly discardUnsaved: boolean };
export interface OpenProjectCommandPort {
  openProject(command: OpenProjectCommand): Promise<ProjectCommandView>;
}
