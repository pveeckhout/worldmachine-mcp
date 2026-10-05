import { unexpectedOutput } from './parsers/unexpected.js';
import type { RawResponse } from './raw-response.js';

/** A failed open is a plain line, not an `Error:` line (spec fact 17). */
export const OPEN_FAILED = 'Failed to open project.';

/**
 * Requires the exact line `Opened: <path>`. World Machine echoes the path verbatim, spaces included
 * (fixture v7-project-ops).
 */
export function requireOpenedLine(response: RawResponse, path: string): void {
  if (!response.output.includes(`Opened: ${path}`)) throw unexpectedOutput('project open', response.output);
}

/** Requires the exact line `Created new default project.`. */
export function requireCreatedLine(response: RawResponse): void {
  if (!response.output.includes('Created new default project.')) {
    throw unexpectedOutput('project new', response.output);
  }
}
