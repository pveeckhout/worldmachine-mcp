import type { SessionSummary } from '../../../../domain/session.js';

export type ProjectCommandView = { readonly session: SessionSummary; readonly path?: string };
export type OpenProjectCommand = { readonly path: string; readonly discardUnsaved: boolean };
export interface OpenProjectCommandPort {
  openProject(command: OpenProjectCommand): Promise<ProjectCommandView>;
}
