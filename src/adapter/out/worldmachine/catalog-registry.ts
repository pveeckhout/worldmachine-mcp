import { join, sep } from 'node:path';
import type { ListCatalogsPort } from '../../../application/port/out/list-catalogs-port.js';
import type { RegisterCatalogsPort } from '../../../application/port/out/register-catalogs-port.js';
import type { EnumCatalog, SourcedPortTypeCatalog } from '../../../domain/catalog.js';

/** What the registry starts with. Shipped enum catalogs are kept apart so `add` can never replace one. */
export type CatalogRegistryInit = {
  /** Shipped and local port-type catalogs, each with its source. */
  readonly portTypes?: readonly SourcedPortTypeCatalog[];
  readonly shippedEnums?: readonly EnumCatalog[];
  readonly localEnums?: readonly EnumCatalog[];
  readonly problems?: readonly string[];
  /** Locates a build's load problems (`<catalogDir>/<build>/...`). */
  readonly catalogDir: string;
};

/**
 * The catalogs in force, read on every call by the port-type and enum readers. Shipped catalogs are never replaced;
 * `add` replaces the local ones of one build.
 */
export class CatalogRegistry implements RegisterCatalogsPort, ListCatalogsPort {
  #portTypes: readonly SourcedPortTypeCatalog[];
  readonly #shippedEnums: readonly EnumCatalog[];
  #localEnums: readonly EnumCatalog[];
  #problems: readonly string[];
  readonly #catalogDir: string;

  constructor(init: CatalogRegistryInit) {
    this.#portTypes = init.portTypes ?? [];
    this.#shippedEnums = init.shippedEnums ?? [];
    this.#localEnums = init.localEnums ?? [];
    this.#problems = init.problems ?? [];
    this.#catalogDir = init.catalogDir;
  }

  portTypeCatalogs(): readonly SourcedPortTypeCatalog[] {
    return this.#portTypes;
  }

  /** Shipped first: the first catalog of a build wins (attachEnumOptions). */
  enumCatalogs(): readonly EnumCatalog[] {
    return [...this.#shippedEnums, ...this.#localEnums];
  }

  problems(): readonly string[] {
    return this.#problems;
  }

  add(
    build: number,
    catalogs: { readonly enumOptions?: EnumCatalog; readonly portTypes?: SourcedPortTypeCatalog },
  ): void {
    const { enumOptions, portTypes } = catalogs;
    if (
      portTypes !== undefined &&
      (portTypes.source.origin !== 'local' || portTypes.source.build !== build)
    ) {
      throw new Error(`catalog registry: not a local port-type catalog of build ${build}`);
    }
    if (enumOptions !== undefined && enumOptions.build !== build) {
      throw new Error(`catalog registry: enum catalog of build ${enumOptions.build}, not ${build}`);
    }
    const prefix = join(this.#catalogDir, String(build)) + sep;
    const clear = (file: string): void => {
      this.#problems = this.#problems.filter((line) => !line.startsWith(`${prefix}${file}`));
    };
    if (portTypes !== undefined) {
      this.#portTypes = [
        ...this.#portTypes.filter(
          (entry) => !(entry.source.origin === 'local' && entry.source.build === build),
        ),
        portTypes,
      ];
      clear('port-types');
    }
    if (enumOptions !== undefined) {
      this.#localEnums = [...this.#localEnums.filter((entry) => entry.build !== build), enumOptions];
      clear('enum-options');
    }
  }
}
