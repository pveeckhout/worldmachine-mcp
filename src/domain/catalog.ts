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
