import type { RawGraphSpec } from '../../../domain/graph-spec.js';
import type { TemplateArgument } from '../../../domain/graph-template.js';

/** Templates design section 5: a template by path, filled and structure-checked. REFUSED for any template problem. */
export interface GraphTemplatePort {
  load(path: string, parameters: Readonly<Record<string, TemplateArgument>>): Promise<RawGraphSpec>;
}
