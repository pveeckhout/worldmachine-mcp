// Types of port-type-catalog.mjs for the tests that import it; tsconfig.json does not allow JavaScript (no allowJs).
export type PortTypeCatalogPortEntry = { port: number; name: string; class: string };
export type PortTypeCatalogData = {
  build: number;
  outputClasses: Record<string, string>;
  inputClasses: Record<string, string[]>;
  types: Record<
    string,
    { added: string[]; inputs: PortTypeCatalogPortEntry[]; outputs: PortTypeCatalogPortEntry[] }
  >;
};
export function parsePortTypeCatalog(
  transcripts: readonly string[],
  systemInfo: string,
  names?: Readonly<Record<string, string>>,
): PortTypeCatalogData;
