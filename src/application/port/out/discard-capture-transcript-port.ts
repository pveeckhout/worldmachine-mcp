export interface DiscardCaptureTranscriptPort {
  /** Removes a capture's working folder once its catalogs are installed; a missing folder is a no-op. */
  discard(workDir: string): void;
}
