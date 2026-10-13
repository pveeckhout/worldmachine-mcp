// Types of port-type-probe.mjs for the tests that import it; tsconfig.json does not allow JavaScript (no allowJs).
export type ProbeSection = { readonly lines: readonly string[] };
export type ProbeSource = { readonly id: number; readonly name: string; readonly port: number };
export type ProbeTarget = { readonly id: number; readonly port: number; readonly inputs: readonly number[] };
export const INCOMPATIBLE: string;
export function acceptedAddWords(transcript: string): string[];
export function readProbeWireList(
  section: ProbeSection | undefined,
): { inputs: { port: number; source: string }[]; outputs: { port: number }[] } | undefined;
export function probeCommands(source: ProbeSource, target: ProbeTarget, lean: boolean): string[];
export function probeVerdict(
  source: ProbeSource,
  target: ProbeTarget,
  answers: readonly (ProbeSection | undefined)[],
  lean: boolean,
): string;
