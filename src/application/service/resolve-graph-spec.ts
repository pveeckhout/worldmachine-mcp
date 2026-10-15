import { WorldMachineError } from '../../domain/errors.js';
import type { RawGraphSpec } from '../../domain/graph-spec.js';
import type { GraphTemplateRef } from '../port/in/query/plan-graph-query.js';
import type { GraphTemplatePort } from '../port/out/graph-template-port.js';

/** Templates design section 3: exactly one of an inline spec and a template, the template loaded and filled. */
export async function resolveGraphSpec(
  source: { readonly spec?: RawGraphSpec; readonly template?: GraphTemplateRef },
  templates: GraphTemplatePort,
): Promise<{ readonly spec: RawGraphSpec; readonly fromTemplate: boolean }> {
  if ((source.spec === undefined) === (source.template === undefined))
    throw new WorldMachineError('REFUSED', 'Give exactly one of spec and template');
  if (source.spec !== undefined) return { spec: source.spec, fromTemplate: false };
  const template = source.template as GraphTemplateRef;
  return { spec: await templates.load(template.path, template.parameters ?? {}), fromTemplate: true };
}
