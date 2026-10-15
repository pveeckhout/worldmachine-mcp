import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import type { GraphTemplatePort } from '../../../application/port/out/graph-template-port.js';
import type { PathPolicyPort } from '../../../application/port/out/path-policy-port.js';
import { WorldMachineError } from '../../../domain/errors.js';
import type { RawGraphSpec } from '../../../domain/graph-spec.js';
import { fillTemplate, type TemplateArgument } from '../../../domain/graph-template.js';
import { graphSpecSchema } from '../../graph-spec-schema.js';

/** Templates design section 2: a template is at most 1 MB. */
export const MAX_TEMPLATE_BYTES = 1_048_576;

/** Templates design sections 4 and 5: authorize, read at most 1 MB, parse, fill, and check the structure. */
export class FsGraphTemplateLoader implements GraphTemplatePort {
  readonly #paths: PathPolicyPort;

  constructor(paths: PathPolicyPort) {
    this.#paths = paths;
  }

  async load(input: string, parameters: Readonly<Record<string, TemplateArgument>>): Promise<RawGraphSpec> {
    const path = await this.#paths.authorizeExistingTemplate(input);
    const refuse = (reason: string): never => {
      throw new WorldMachineError('REFUSED', `${path}: ${reason}`);
    };
    let bytes: Buffer;
    try {
      // Non-blocking, so a FIFO swapped in after the policy check opens at once and the isFile check refuses it;
      // it changes nothing for a regular file. Windows has no O_NONBLOCK, so the flags fall back to O_RDONLY.
      const handle = await open(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
      try {
        // The policy checked the file before open; this catches a directory or FIFO swapped in since.
        if (!(await handle.stat()).isFile()) refuse('not a regular file');
        // One byte more than the limit tells an oversized file without reading all of it. A read may return
        // fewer bytes than asked, so read until end of file or past the limit.
        const buffer = Buffer.alloc(MAX_TEMPLATE_BYTES + 1);
        let filled = 0;
        while (filled < buffer.length) {
          const { bytesRead } = await handle.read(buffer, filled, buffer.length - filled, filled);
          if (bytesRead === 0) break;
          filled += bytesRead;
        }
        if (filled > MAX_TEMPLATE_BYTES) refuse('the file is larger than 1 MB');
        bytes = buffer.subarray(0, filled);
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (error instanceof WorldMachineError) throw error;
      return refuse(`the file cannot be read (${error instanceof Error ? error.message : String(error)})`);
    }
    // Templates design section 2: the file is UTF-8. One leading byte order mark is dropped, as Windows editors
    // write one; a broken byte is refused rather than replaced.
    const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
        hasBom ? bytes.subarray(3) : bytes,
      );
    } catch {
      return refuse('not valid UTF-8');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      return refuse(`not valid JSON (${error instanceof Error ? error.message : String(error)})`);
    }
    const filled = fillTemplate(parsed, parameters, path);
    const checked = graphSpecSchema.safeParse(filled);
    if (!checked.success) {
      const first = checked.error.issues[0];
      return refuse(
        `the filled spec is not a graph spec (${first === undefined ? 'unknown shape' : `${first.path.join('.')}: ${first.message}`})`,
      );
    }
    return checked.data;
  }
}
