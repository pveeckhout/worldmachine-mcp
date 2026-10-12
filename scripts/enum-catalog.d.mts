// Types of enum-catalog.mjs for the tests that import it; tsconfig.json does not allow JavaScript (no allowJs).
export type EnumCatalogEntry = { parameters: string[]; enums: Record<string, string[]> };
export type EnumCatalogData = { build: number; types: Record<string, EnumCatalogEntry> };
export function parseEnumCatalog(transcript: string, systemInfo: string): EnumCatalogData;
