export interface CommandChannel {
  /** Non-log output lines, in arrival order. */
  onLine(listener: (line: string) => void): void;
  /**
   * Runs once, after every output line has been delivered. A listener added after the exit runs
   * asynchronously (the queue relies on it).
   */
  onExit(listener: () => void): void;
  write(lines: readonly string[]): void;
}
