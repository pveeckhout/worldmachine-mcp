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
    let text: string;
    try {
      const handle = await open(path, 'r');
      try {
        // One byte more than the limit tells an oversized file without reading all of it.
        const buffer = Buffer.alloc(MAX_TEMPLATE_BYTES + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (bytesRead > MAX_TEMPLATE_BYTES) refuse('the file is larger than 1 MB');
        text = buffer.subarray(0, bytesRead).toString('utf8');
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (error instanceof WorldMachineError) throw error;
      return refuse(`the file cannot be read (${error instanceof Error ? error.message : String(error)})`);
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
