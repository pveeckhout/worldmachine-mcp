export interface RetirePortTypeCorrectionsPort {
  /** Moves the build's corrections file aside as `.previous` and forgets its entries. A build with none is a no-op. */
  retire(build: number): void;
}
