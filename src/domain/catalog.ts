/** Whether a catalog comes from a full probe run (strict) or from a sample checked against a strict base. */
export type CatalogKind = 'strict' | 'sample-derived';
/** Where a catalog comes from: shipped with the server, or built on this machine. */
export type CatalogOrigin = 'shipped' | 'local';
/** The catalog that applies to one World Machine build, with how it was made and where it lives. */
export type CatalogSource = {
  readonly build: number;
  readonly kind: CatalogKind;
  readonly origin: CatalogOrigin;
};

/** Lookup order per build: shipped strict, local full, shipped sample-derived, local short. */
function rank(source: CatalogSource): number {
  if (source.kind === 'strict') return source.origin === 'shipped' ? 0 : 1;
  return source.origin === 'shipped' ? 2 : 3;
}

/** The catalog to use for a build: the best-ranked candidate of that build, the first one on ties. */
export function selectCatalog<T extends { readonly source: CatalogSource }>(
  candidates: readonly T[],
  build: number | undefined,
): T | undefined {
  if (build === undefined) return undefined;
  let best: T | undefined;
  for (const candidate of candidates) {
    if (candidate.source.build !== build) continue;
    if (best === undefined || rank(candidate.source) < rank(best.source)) best = candidate;
  }
  return best;
}

/** How a catalog is described to the user. */
export function catalogLabel(source: CatalogSource): 'shipped' | 'local full' | 'local short' {
  if (source.origin === 'shipped') return 'shipped';
  return source.kind === 'strict' ? 'local full' : 'local short';
}
