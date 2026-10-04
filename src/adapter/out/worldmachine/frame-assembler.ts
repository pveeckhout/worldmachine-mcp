import { SENTINEL_PREFIX, sentinelEcho } from './command-builder.js';
import type { RawResponse } from './raw-response.js';

const ERROR_PREFIX = 'Error: ';
const ANY_SENTINEL_ECHO = `${ERROR_PREFIX}Unknown command: '${SENTINEL_PREFIX}`;

export class FrameAssembler {
  readonly #batchId: string;
  readonly #commands: readonly string[];
  readonly #responses: RawResponse[] = [];
  #output: string[] = [];
  #errors: string[] = [];

  constructor(batchId: string, commands: readonly string[]) {
    this.#batchId = batchId;
    this.#commands = commands;
  }

  push(line: string): boolean {
    if (this.done) return true;
    const index = this.#responses.length;
    if (line.startsWith(sentinelEcho(this.#batchId, index))) {
      this.#responses.push({
        command: this.#commands[index] ?? '',
        output: trimBlankLines(this.#output),
        errors: this.#errors,
      });
      this.#output = [];
      this.#errors = [];
      return this.done;
    }
    if (line.startsWith(ANY_SENTINEL_ECHO)) return false;
    if (line.startsWith(ERROR_PREFIX)) this.#errors.push(line);
    else this.#output.push(line);
    return false;
  }

  get done(): boolean {
    return this.#responses.length === this.#commands.length;
  }

  get responses(): readonly RawResponse[] {
    return this.#responses;
  }
}

function trimBlankLines(lines: readonly string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]?.trim() === '') start++;
  while (end > start && lines[end - 1]?.trim() === '') end--;
  return lines.slice(start, end);
}
