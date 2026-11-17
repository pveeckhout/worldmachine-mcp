import type { EnumCatalog, PortTypeCatalog } from '../../../domain/catalog.js';

/** The catalogs built on this machine, with the files that were ignored. */
export type LocalCatalogs = {
  readonly enumCatalogs: readonly EnumCatalog[];
  readonly portTypeCatalogs: readonly PortTypeCatalog[];
  /** One line per file that was ignored: path and reason. */
  readonly problems: readonly string[];
};

/** Reads the catalogs the user built, once, at startup. */
export interface LoadLocalCatalogsPort {
  load(): LocalCatalogs;
}
