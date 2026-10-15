import { WorldMachineError } from './errors.js';

/** Templates design section 2: an argument is a scalar. */
export type TemplateArgument = string | number | boolean;

type ParameterType = 'number' | 'integer' | 'string' | 'boolean';
type Declaration = { readonly type: ParameterType; readonly default?: TemplateArgument };

const TYPES: readonly ParameterType[] = ['number', 'integer', 'string', 'boolean'];

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Whether a value is acceptable for a declared parameter type. */
function fits(type: ParameterType, value: unknown): boolean {
  switch (type) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isSafeInteger(value);
    case 'string':
      return typeof value === 'string';
    case 'boolean':
      return typeof value === 'boolean';
  }
}

const article = (type: ParameterType): string => (type === 'integer' ? 'an integer' : `a ${type}`);
const shown = (value: unknown): string => (typeof value === 'number' ? String(value) : JSON.stringify(value));

/**
 * Templates design section 2: fills `{ "$param": "<name>" }` references in the template's spec with the arguments or
 * the declared defaults, after checking the envelope, the declarations, the references, and the arguments. A file
 * without a `template` key is a plain spec, checked like a template with no parameters. Pure; refuses with REFUSED naming `path`.
 */
export function fillTemplate(
  file: unknown,
  args: Readonly<Record<string, TemplateArgument>>,
  path: string,
): unknown {
  const refuse = (message: string): never => {
    throw new WorldMachineError('REFUSED', `${path}: ${message}`);
  };
  if (!isObject(file)) return refuse('a template must be a JSON object');
  // A file without a `template` key is a template without parameters, so its spec is the file itself.
  const isTemplate = 'template' in file;
  if (isTemplate) {
    if (file.template !== 1) refuse(`template must be 1, not ${shown(file.template)}`);
    if (!('spec' in file)) refuse('a template needs a spec');
  }
  const rawParameters = (isTemplate ? file.parameters : undefined) ?? {};
  if (!isObject(rawParameters)) return refuse('parameters must be an object');

  const declarations = new Map<string, Declaration>();
  for (const [name, raw] of Object.entries(rawParameters)) {
    if (!isObject(raw) || typeof raw.type !== 'string')
      refuse(`parameter '${name}' must be an object with a type`);
    const declared = raw as Record<string, unknown>;
    const type = declared.type as string;
    if (!TYPES.includes(type as ParameterType))
      refuse(`parameter '${name}' has type '${type}'; the types are number, integer, string, and boolean`);
    const parameterType = type as ParameterType;
    if ('default' in declared && !fits(parameterType, declared.default))
      refuse(`parameter '${name}': the default ${shown(declared.default)} is not ${article(parameterType)}`);
    declarations.set(name, {
      type: parameterType,
      ...('default' in declared ? { default: declared.default as TemplateArgument } : {}),
    });
  }

  for (const [name, value] of Object.entries(args)) {
    const declared = declarations.get(name);
    if (declared === undefined) refuse(`argument '${name}' is not a parameter of this template`);
    else if (!fits(declared.type, value))
      refuse(`argument '${name}' must be ${article(declared.type)}, not ${shown(value)}`);
  }

  const used = new Set<string>();
  const fill = (value: unknown, at: string): unknown => {
    if (Array.isArray(value)) return value.map((item, index) => fill(item, `${at}[${index}]`));
    if (!isObject(value)) return value;
    if ('$param' in value) {
      if (Object.keys(value).length !== 1) refuse(`${at} has $param beside other keys`);
      const name = value.$param;
      if (typeof name !== 'string') return refuse(`${at} has a $param that is not a parameter name`);
      const declared = declarations.get(name);
      if (declared === undefined) return refuse(`${at} refers to parameter '${name}', which is not declared`);
      used.add(name);
      const argument = Object.hasOwn(args, name) ? args[name] : declared.default;
      if (argument === undefined) return refuse(`parameter '${name}' needs an argument; it has no default`);
      return argument;
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fill(item, `${at}.${key}`)]));
  };
  const filled = fill(isTemplate ? file.spec : file, 'spec');
  for (const name of declarations.keys()) {
    if (!used.has(name)) refuse(`parameter '${name}' is declared but no $param uses it`);
  }
  return filled;
}
