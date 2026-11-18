import { join, sep } from 'node:path';
import type { RegisterCatalogsPort } from '../../../application/port/out/register-catalogs-port.js';
import type { EnumCatalog, SourcedPortTypeCatalog } from '../../../domain/catalog.js';
import { ENUM_CATALOGS } from './enum-options.js';

/**
 * The catalogs in force, read on every call by the port-type and enum readers. Shipped catalogs are never replaced;
 * `add` replaces the local ones of one build. `catalogDir` locates a build's load problems (`<catalogDir>/<build>/...`).
 */
export class CatalogRegistry implements RegisterCatalogsPort {
  #portTypes: readonly SourcedPortTypeCatalog[];
  #enums: readonly EnumCatalog[];
  #problems: readonly string[];
  readonly #catalogDir: string;

  constructor(
    portTypes: readonly SourcedPortTypeCatalog[],
    enums: readonly EnumCatalog[],
    problems: readonly string[],
    catalogDir: string,
  ) {
    this.#portTypes = portTypes;
    this.#enums = enums;
    this.#problems = problems;
    this.#catalogDir = catalogDir;
  }

  portTypeCatalogs(): readonly SourcedPortTypeCatalog[] {
    return this.#portTypes;
  }

  enumCatalogs(): readonly EnumCatalog[] {
    return this.#enums;
  }

  problems(): readonly string[] {
    return this.#problems;
  }

  add(
    build: number,
    catalogs: { readonly enumOptions?: EnumCatalog; readonly portTypes?: SourcedPortTypeCatalog },
  ): void {
    if (catalogs.portTypes !== undefined) {
      this.#portTypes = [
        ...this.#portTypes.filter(
          (entry) => !(entry.source.origin === 'local' && entry.source.build === build),
        ),
        catalogs.portTypes,
      ];
    }
    if (catalogs.enumOptions !== undefined) {
      // A shipped enum catalog comes first and wins, so it is kept; the new one only replaces a local one.
      this.#enums = [
        ...this.#enums.filter((entry) => entry.build !== build || ENUM_CATALOGS.includes(entry)),
        catalogs.enumOptions,
      ];
    }
    const prefix = join(this.#catalogDir, String(build)) + sep;
    this.#problems = this.#problems.filter((line) => !line.startsWith(prefix));
  }
}
