import type { WireCompatibility } from './port-types.js';

/** Whether a catalog comes from a full probe run (strict) or from a sample checked against a strict base. */
export type CatalogKind = 'strict' | 'sample-derived';
/** Where a catalog comes from: shipped with the server, or built on this machine. */
export type CatalogOrigin = 'shipped' | 'local';
/** The catalog that applies to one World Machine build, with how it was made and where it lives. */
export type CatalogSource = {
  readonly build: number;
  readonly kind: CatalogKind;
  readonly origin: CatalogOrigin;
};

/** A port-type catalog with the source `selectCatalog` ranks it by. */
export type SourcedPortTypeCatalog = { readonly catalog: PortTypeCatalog; readonly source: CatalogSource };

/** Lookup order per build: shipped strict, local full, shipped sample-derived, local short. */
function rank(source: CatalogSource): number {
  if (source.kind === 'strict') return source.origin === 'shipped' ? 0 : 1;
  return source.origin === 'shipped' ? 2 : 3;
}

/** The catalog to use for a build: the best-ranked candidate of that build, the first one on ties. */
export function selectCatalog<T extends { readonly source: CatalogSource }>(
  candidates: readonly T[],
  build: number | undefined,
): T | undefined {
  if (build === undefined) return undefined;
  let best: T | undefined;
  for (const candidate of candidates) {
    if (candidate.source.build !== build) continue;
    if (best === undefined || rank(candidate.source) < rank(best.source)) best = candidate;
  }
  return best;
}

/** The strict candidate to check a sample of `build` against: the highest build below it, else the lowest. */
export function closestStrictBase<T extends { readonly source: CatalogSource }>(
  candidates: readonly T[],
  build: number,
): T | undefined {
  const strict = candidates.filter((candidate) => candidate.source.kind === 'strict');
  const pick = (list: readonly T[], better: (a: number, b: number) => boolean): T | undefined =>
    list.reduce<T | undefined>(
      (best, candidate) =>
        best === undefined || better(candidate.source.build, best.source.build) ? candidate : best,
      undefined,
    );
  return (
    pick(
      strict.filter((candidate) => candidate.source.build < build),
      (a, b) => a > b,
    ) ?? pick(strict, (a, b) => a < b)
  );
}

/** How a catalog is described to the user. */
export function catalogLabel(source: CatalogSource): 'shipped' | 'local full' | 'local short' {
  if (source.origin === 'shipped') return 'shipped';
  return source.kind === 'strict' ? 'local full' : 'local short';
}

/** Which catalogs answered for a response: the build, the port-type catalog used, and any startup problems. */
export type CatalogInfo = {
  readonly build: number | null;
  readonly portTypes: 'shipped' | 'local full' | 'local short' | 'none';
  readonly corrections: boolean;
  /** Startup problems with local catalog files; left out when none. */
  readonly problems?: readonly string[];
  /** The offer to capture a catalog; left out unless the build is known and has no port-type catalog. */
  readonly capture?: string;
};

/** Estimated whole-run minutes per capture mode, as the caller knows them. */
export type CaptureMinutes = { readonly short: number; readonly full: number };

/** The catalog info of a response; `hasCorrections`: the catalog in use is sample-derived and its build has some. */
export function catalogInfo(
  build: number | undefined,
  source: CatalogSource | undefined,
  problems: readonly string[],
  hasCorrections: boolean,
  captureMinutes?: CaptureMinutes,
): CatalogInfo {
  const offer =
    captureMinutes !== undefined && source === undefined && build !== undefined
      ? `No catalog for build ${build}. capture_catalog can capture one: short (about ${captureMinutes.short} min) or full (about ${captureMinutes.full} min). World Machine is busy for the whole run and closes the open project first; keep the mouse pointer off its window.`
      : undefined;
  return {
    build: build ?? null,
    portTypes: source === undefined ? 'none' : catalogLabel(source),
    corrections: hasCorrections,
    ...(problems.length > 0 ? { problems } : {}),
    ...(offer === undefined ? {} : { capture: offer }),
  };
}

/** A catalogued port: its number and name as `wire list` shows them, and its class id. */
export type PortTypeCatalogEntry = { readonly port: number; readonly name: string; readonly class: string };

/** A catalogued type: the `device add` words that gave it (Codex round 1 ruling B1) and its ports in order. */
export type PortTypeCatalogType = {
  readonly added: readonly string[];
  readonly inputs: readonly PortTypeCatalogEntry[];
  readonly outputs: readonly PortTypeCatalogEntry[];
};

/**
 * Port-types design section 4, plan decision D4: per World Machine build, the output classes by id and name, the
 * output classes each input class accepts, and per listed device type its add spellings and its ports in order with
 * their class. Generated by scripts/build-port-type-catalog.mjs, or derived by scripts/derive-port-type-catalog.mjs;
 * never edited by hand.
 */
export type PortTypeCatalog = {
  readonly build: number;
  readonly kind: CatalogKind;
  readonly outputClasses: Readonly<Record<string, string>>;
  readonly inputClasses: Readonly<Record<string, readonly string[]>>;
  readonly types: Readonly<Record<string, PortTypeCatalogType>>;
};

/**
 * Per listed device type, captured from one World Machine build (enum-options design section 3): `parameters`, every
 * row name of a new device's `param list` in printed order, and `enums`, the labels in index order of each enum row.
 * Generated by scripts/build-enum-catalog.mjs; never edited by hand.
 */
export type EnumCatalog = {
  readonly build: number;
  readonly types: Readonly<
    Record<
      string,
      { readonly parameters: readonly string[]; readonly enums: Readonly<Record<string, readonly string[]>> }
    >
  >;
};

/** One end of a wire: device type and port name. */
export type PortRef = { readonly type: string; readonly port: string };
export type WireVerdict = 'accepted' | 'refused';
export type VerdictSource = 'apply_graph' | 'connect_devices';
export type PortTypeCorrection = {
  readonly build: number;
  readonly output: PortRef;
  readonly input: PortRef;
  readonly verdict: WireVerdict;
  readonly source: VerdictSource;
  readonly at: string;
};

/** `Type.Output`, as in port-type-names.4067.json. */
export function portKey(ref: PortRef): string {
  return `${ref.type}.${ref.port}`;
}

export function pairKey(output: PortRef, input: PortRef): string {
  return `${portKey(output)}->${portKey(input)}`;
}

/** The verdict per pair; a later correction of the same pair replaces an earlier one. */
export function correctionIndex(
  corrections: readonly PortTypeCorrection[],
): ReadonlyMap<string, WireVerdict> {
  const index = new Map<string, WireVerdict>();
  for (const c of corrections) index.set(pairKey(c.output, c.input), c.verdict);
  return index;
}

/** Devices that may take their type from their inputs; their wires are never corrected. */
export const ADAPTIVE_TYPES: ReadonlySet<string> = new Set(['Chooser', 'Combiner', 'Layers', 'Router']);

/** What the connect showed: both ends' refs when typed, the catalog's prediction (with corrections applied). */
export type WireTyping = {
  readonly output: PortRef | undefined;
  readonly input: PortRef | undefined;
  readonly predicted: WireCompatibility;
};

export type VerdictReport = {
  readonly pair: string;
  readonly verdict: WireVerdict;
  readonly predicted: 'compatible' | 'incompatible';
  readonly outcome: 'recorded' | 'reported';
  /** Why it was only reported: 'strict catalog' or 'adaptive device'. Absent when recorded. */
  readonly reason?: string;
};

/** undefined when World Machine agreed with the prediction, or the wire was unchecked with no typed end at all. */
export function judgeVerdict(
  kind: CatalogKind | undefined,
  typing: WireTyping,
  verdict: WireVerdict,
): VerdictReport | undefined {
  const { output, input, predicted } = typing;
  if (predicted === 'unchecked') return undefined;
  if ((verdict === 'accepted') === (predicted === 'compatible')) return undefined;
  const pair = `${output ? portKey(output) : '?'}->${input ? portKey(input) : '?'}`;
  const base = { pair, verdict, predicted };
  const adaptive =
    (output !== undefined && ADAPTIVE_TYPES.has(output.type)) ||
    (input !== undefined && ADAPTIVE_TYPES.has(input.type));
  if (adaptive) return { ...base, outcome: 'reported', reason: 'adaptive device' };
  if (kind === 'strict') return { ...base, outcome: 'reported', reason: 'strict catalog' };
  return { ...base, outcome: 'recorded' };
}

/**
 * A device type a capture found: the name `device add` takes for it, the other names that add the same type, and
 * whether this build added it (a known type it could not add is listed with `reached: false`).
 */
export type DeviceType = {
  readonly addName: string;
  readonly aliases: readonly string[];
  readonly reached: boolean;
};

/** Throws when an alias names another type of the list (spec D2a invariant). */
export function checkDeviceTypes(types: readonly DeviceType[]): void {
  const names = new Set(types.map((type) => type.addName));
  for (const type of types)
    for (const alias of type.aliases)
      if (names.has(alias) && alias !== type.addName)
        throw new Error(`alias '${alias}' of '${type.addName}' names another type`);
}

/** What device type discovery found on a build (spec D2a); it never claims a complete list. */
export type DeviceDiscovery = {
  readonly types: readonly DeviceType[];
  /** Known types not added on this build. */
  readonly notReached: readonly string[];
  /** false on a build without the ambiguity error (4067 and earlier): only the known lists were used. */
  readonly listedByConsole: boolean;
};

/** A moved add word: it gave another type in the base catalog than in the sample. */
export type MovedWord = { readonly word: string; readonly from: string; readonly to: string };

/** The outcome of checking a `port-types-sample` against a strict base catalog. */
export type SampleCheck =
  | {
      readonly agreed: true;
      readonly catalog: PortTypeCatalog;
      readonly omittedTypes: readonly string[];
      readonly untypedTypes: readonly string[];
      readonly movedWords: readonly MovedWord[];
    }
  | {
      readonly agreed: false;
      readonly disagreement: string;
      readonly omittedTypes: readonly string[];
      readonly untypedTypes: readonly string[];
    };
