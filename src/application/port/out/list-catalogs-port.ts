import type { EnumCatalog, SourcedPortTypeCatalog } from '../../../domain/catalog.js';

/** The catalogs in force, shipped and local, as the next tool call would use them. */
export interface ListCatalogsPort {
  portTypeCatalogs(): readonly SourcedPortTypeCatalog[];
  enumCatalogs(): readonly EnumCatalog[];
}
