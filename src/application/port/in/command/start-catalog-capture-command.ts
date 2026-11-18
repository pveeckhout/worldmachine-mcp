import type { CaptureMode, CaptureView } from '../../../../domain/catalog-capture.js';

export type StartCatalogCaptureCommand = { readonly mode: CaptureMode; readonly discardOpenProject: boolean };

export interface StartCatalogCapturePort {
  /** Starts a capture in the background and returns its first view; the run goes on after this returns. */
  start(command: StartCatalogCaptureCommand): Promise<CaptureView>;
}
