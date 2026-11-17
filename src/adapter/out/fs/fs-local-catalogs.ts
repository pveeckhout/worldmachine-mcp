import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  LoadLocalCatalogsPort,
  LocalCatalogs,
} from '../../../application/port/out/load-local-catalogs-port.js';
import type { EnumCatalog, PortTypeCatalog } from '../../../domain/catalog.js';
import { readEnumCatalog, readPortTypeCatalog } from '../worldmachine/catalog-reader.js';

/** Catalogs built on this machine: `<directory>/<build>/enum-options.json` and `port-types.json`. Startup only. */
export class FsLocalCatalogs implements LoadLocalCatalogsPort {
  readonly #directory: string;

  constructor(directory: string) {
    this.#directory = directory;
  }

  load(): LocalCatalogs {
    const enumCatalogs: EnumCatalog[] = [];
    const portTypeCatalogs: PortTypeCatalog[] = [];
    const problems: string[] = [];
    const read = <T extends { readonly build: number }>(
      build: string,
      file: string,
      reader: (json: unknown) => T,
      into: T[],
    ): void => {
      const path = join(this.#directory, build, file);
      if (!existsSync(path)) return;
      try {
        const catalog = reader(JSON.parse(readFileSync(path, 'utf8')));
        if (catalog.build !== Number(build)) {
          throw new Error(`build ${catalog.build} in a folder for build ${build}`);
        }
        into.push(catalog);
      } catch (error) {
        problems.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    for (const entry of this.#builds()) {
      read(entry, 'enum-options.json', readEnumCatalog, enumCatalogs);
      read(entry, 'port-types.json', readPortTypeCatalog, portTypeCatalogs);
    }
    return { enumCatalogs, portTypeCatalogs, problems };
  }

  #builds(): string[] {
    try {
      return readdirSync(this.#directory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
        .map((entry) => entry.name)
        .sort();
    } catch {
      return [];
    }
  }
}
