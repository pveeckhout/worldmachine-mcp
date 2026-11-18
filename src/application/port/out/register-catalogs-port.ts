import type { EnumCatalog, SourcedPortTypeCatalog } from '../../../domain/catalog.js';

/** Makes a catalog installed on this machine answer the next call, without a restart. */
export interface RegisterCatalogsPort {
  /** Replaces the local catalogs of `build` with these and clears that build's local load problems. */
  add(
    build: number,
    catalogs: { readonly enumOptions?: EnumCatalog; readonly portTypes?: SourcedPortTypeCatalog },
  ): void;
}
