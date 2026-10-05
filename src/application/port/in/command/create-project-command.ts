import type { ProjectCommandView } from './open-project-command.js';

export type CreateProjectCommand = { readonly discardUnsaved: boolean };
export interface CreateProjectCommandPort {
  createProject(command: CreateProjectCommand): Promise<ProjectCommandView>;
}
