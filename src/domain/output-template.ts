// Pure path functions: the first `node:` import in the domain (decision D3).
import { basename, dirname, extname, isAbsolute, join, normalize } from 'node:path';

/** One row of `export list` (fact 49): a device name and its file name template. */
export type ExportTarget = {
  readonly device: string;
  readonly template: string;
  /** The row held more than one `' -> '`, so device and template are a guess; the target is refused. */
  readonly ambiguous?: true;
};

export type OutputPath =
  | { readonly kind: 'path'; readonly path: string }
  | { readonly kind: 'unknown-token'; readonly token: string }
  | { readonly kind: 'invalid'; readonly reason: string };

export type TemplateContext = {
  /** The saved `.tmd` file that templates resolve against (fact 50). */
  readonly projectFile: string;
  readonly resolution: number;
};

/** A target with its expanded path, and whether World Machine may write there (spec v2a section 6). */
export type CheckedExportTarget = {
  readonly device: string;
  readonly template: string;
  readonly path: string | null;
  readonly allowed: boolean;
  readonly reason?: string;
};

const TOKEN = /<([^<>]*)>/g;

/** Check if a string contains ".." as a path segment (exactly ".." when split on "/".) */
function hasParentPathSegment(str: string): boolean {
  const segments = str.split('/');
  return segments.some((seg) => seg === '..');
}

/**
 * Spec v2a section 3: `<project>` is the `.tmd` file name without its extension, `<name>` the device name, `<res>`
 * the scene resolution; a relative result is joined to the project folder. Any other `<...>` token makes the folder
 * unknowable, so the target is not expanded.
 *
 * Refusals (ruling P2-1):
 * - ".." segment in template or device name: security / symlink escape prevention
 * - empty or "." final component in expanded path: prevents directory traversal
 */
export function expandTemplate(target: ExportTarget, context: TemplateContext): OutputPath {
  if (target.ambiguous) {
    return {
      kind: 'invalid',
      reason: "the device name or the template contains ' -> ', so the target cannot be read reliably",
    };
  }
  // Check (a): reject ".." segments in template and device name before any join/normalize
  if (hasParentPathSegment(target.template) || hasParentPathSegment(target.device)) {
    return {
      kind: 'invalid',
      reason: "the template or the device name contains a '..' path segment",
    };
  }

  // Check (b) part 1: reject if device name is empty or "."
  if (target.device === '' || target.device === '.') {
    return {
      kind: 'invalid',
      reason: 'the expanded path has no file name',
    };
  }

  const values = new Map([
    ['project', basename(context.projectFile, extname(context.projectFile))],
    ['name', target.device],
    ['res', String(context.resolution)],
  ]);
  let unknown: string | undefined;
  // One pass with a replacer function: `<...>` text inside a device name is not read as a token, and `$` in a
  // name stays literal.
  const expanded = target.template.replace(TOKEN, (match, token: string) => {
    const value = values.get(token);
    if (value === undefined) unknown ??= match;
    return value ?? match;
  });
  if (unknown !== undefined) return { kind: 'unknown-token', token: unknown };

  // Ruling P11-2: a value substituted for a token (a project named `...tmd` gives `..`) can create a dot segment that
  // the raw template did not have; World Machine resolves it through symlinks, join/normalize would not.
  if (expanded.split('/').some((segment) => segment === '.' || segment === '..')) {
    return { kind: 'invalid', reason: "the expanded path contains a '.' or '..' segment" };
  }

  // Check (b): reject if expanded string ends with "/" or has an empty/dot final component
  if (expanded.endsWith('/')) {
    return {
      kind: 'invalid',
      reason: 'the expanded path has no file name',
    };
  }

  // Check if the expanded string would have an empty or "." basename
  const expandedBasename = basename(expanded);
  if (expandedBasename === '' || expandedBasename === '.') {
    return {
      kind: 'invalid',
      reason: 'the expanded path has no file name',
    };
  }

  const path = isAbsolute(expanded) ? normalize(expanded) : join(dirname(context.projectFile), expanded);

  return {
    kind: 'path',
    path,
  };
}

/** True when `<token>` appears in the folder part of a template, before its last `/`. */
export function usesTokenInFolder(template: string, token: string): boolean {
  const slash = template.lastIndexOf('/');
  return slash !== -1 && template.slice(0, slash).includes(`<${token}>`);
}

export function folderOf(path: string): string {
  return dirname(path);
}
