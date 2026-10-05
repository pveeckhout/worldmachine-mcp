import type { SessionSummary } from '../../../../domain/session.js';

/** What every project command use case returns: the session after the command, and the project path if any. */
export type ProjectCommandView = { readonly session: SessionSummary; readonly path?: string };
