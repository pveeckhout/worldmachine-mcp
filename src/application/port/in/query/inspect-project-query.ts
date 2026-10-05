import type { ProjectOverview } from '../../../../domain/project.js';
import type { SessionSummary } from '../../../../domain/session.js';

export type InspectProjectQuery = Readonly<Record<string, never>>;
export type ProjectView = { readonly project: ProjectOverview; readonly session: SessionSummary };
export interface InspectProjectQueryPort {
  inspectProject(query: InspectProjectQuery): Promise<ProjectView>;
}
