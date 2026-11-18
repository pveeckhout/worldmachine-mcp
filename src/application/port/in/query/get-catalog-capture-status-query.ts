import type { CaptureView } from '../../../../domain/catalog-capture.js';

export type GetCatalogCaptureStatusQuery = Record<string, never>;

export interface GetCatalogCaptureStatusPort {
  /** The running capture, else the last finished one until the next start; null before the first. */
  status(query: GetCatalogCaptureStatusQuery): Promise<CaptureView | null>;
}
