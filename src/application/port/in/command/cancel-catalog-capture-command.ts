import type { CaptureView } from '../../../../domain/catalog-capture.js';

export type CancelCatalogCaptureCommand = Record<string, never>;

export interface CancelCatalogCapturePort {
  /** Stops the running capture after its current batch and returns its final view; null when none runs. */
  cancel(command: CancelCatalogCaptureCommand): Promise<CaptureView | null>;
}
