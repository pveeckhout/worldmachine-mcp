// Types of enum-catalog.mjs for the tests that import it; tsconfig.json does not allow JavaScript (no allowJs).
export type EnumCatalogData = { build: number; types: Record<string, Record<string, string[]>> };
export type TranscriptSection = { command: string; lines: string[] };
export function parseEnumCatalog(transcript: string, systemInfo: string): EnumCatalogData;
