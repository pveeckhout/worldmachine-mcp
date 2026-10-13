// Types of wire-list.mjs for the tests that import it; tsconfig.json does not allow JavaScript (no allowJs).
export const DEVICE_ROW: RegExp;
export const HEADER: RegExp;
export const INPUT: RegExp;
export const OUTPUT: RegExp;
export const CONTINUATION: RegExp;
export type WireListPort = { port: number; name: string };
export function readWireList(
  command: string,
  lines: readonly string[],
): { inputs: WireListPort[]; outputs: WireListPort[] };
