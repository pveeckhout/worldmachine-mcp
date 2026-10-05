import type { ProjectCommandView } from './project-command-view.js';

export type CreateProjectCommand = { readonly discardUnsaved: boolean };
export interface CreateProjectCommandPort {
  createProject(command: CreateProjectCommand): Promise<ProjectCommandView>;
}
