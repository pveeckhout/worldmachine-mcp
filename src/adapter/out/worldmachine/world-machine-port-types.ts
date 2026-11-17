import type { PortTypeCatalogPort } from '../../../application/port/out/port-type-catalog-port.js';
import type { WorldMachineSessionPort } from '../../../application/port/out/world-machine-session-port.js';
import {
  type CatalogSource,
  type PortTypeCatalog,
  type PortTypeCatalogEntry,
  type PortTypeCatalogType,
  selectCatalog,
} from '../../../domain/catalog.js';
import type { DeviceDetail } from '../../../domain/device.js';
import { type CataloguedPorts, type PortClass, typedPorts } from '../../../domain/port-types.js';
import shipped4067 from './port-types.4067.json' with { type: 'json' };
import shipped4069 from './port-types.4069.json' with { type: 'json' };

export type { PortTypeCatalog, PortTypeCatalogEntry };

/**
 * Shipped with the server: wm-4067/raw/port-types*.txt (the full run, its resume, and the twin run), named by
 * scripts/port-type-names.4067.json.
 */
export const PORT_TYPE_CATALOG_4067: PortTypeCatalog = shipped4067 as PortTypeCatalog;
/**
 * Shipped with the server: the 4067 catalog checked against wm-4069/raw/port-types-sample.txt and derived from it
 * (2026-11-17): its ports and classes, with the add words build 4069 accepted. Every verdict of the sample agreed.
 */
export const PORT_TYPE_CATALOG_4069: PortTypeCatalog = shipped4069 as PortTypeCatalog;

/** A port-type catalog with the source `selectCatalog` ranks it by. */
export type SourcedPortTypeCatalog = { readonly catalog: PortTypeCatalog; readonly source: CatalogSource };

const sourced = (catalog: PortTypeCatalog, origin: CatalogSource['origin']): SourcedPortTypeCatalog => ({
  catalog,
  source: { build: catalog.build, kind: catalog.kind, origin },
});
/** A catalog shipped with the server. */
export const shipped = (catalog: PortTypeCatalog): SourcedPortTypeCatalog => sourced(catalog, 'shipped');
/** A catalog built on this machine. */
export const local = (catalog: PortTypeCatalog): SourcedPortTypeCatalog => sourced(catalog, 'local');

/** Every shipped catalog; the best one of World Machine's build applies (selectCatalog). */
export const PORT_TYPE_CATALOGS: readonly SourcedPortTypeCatalog[] = [
  shipped(PORT_TYPE_CATALOG_4067),
  shipped(PORT_TYPE_CATALOG_4069),
];

/** Port types of nothing: the default of the reader and the wire editor (port-types plan decision D3). */
export const NO_PORT_TYPES: PortTypeCatalogPort = {
  portsOf: () => undefined,
  portsOfAdded: () => undefined,
  catalogInUse: () => undefined,
};

/** An own entry only: a catalog parsed from JSON still inherits `constructor` and `toString` from Object.prototype. */
const own = <T>(record: Readonly<Record<string, T>>, key: string): T | undefined =>
  Object.hasOwn(record, key) ? record[key] : undefined;

/** The item at `index`; the fingerprint has matched the lengths, so a miss is a bug. */
const at = <T>(items: readonly T[], index: number): T => {
  const item = items[index];
  if (item === undefined) throw new Error(`port types: no catalogued port at index ${index}`);
  return item;
};

/** A catalogued type's ports with their classes resolved. */
function resolvePorts(catalog: PortTypeCatalog, entry: PortTypeCatalogType): CataloguedPorts {
  const outputClass = (id: string): PortClass => {
    const name = own(catalog.outputClasses, id);
    if (name === undefined) throw new Error(`port-type catalog: no output class '${id}'`);
    return { id, name };
  };
  return {
    inputs: entry.inputs.map(({ port, name, class: id }) => {
      const accepted = own(catalog.inputClasses, id);
      if (accepted === undefined) throw new Error(`port-type catalog: no input class '${id}'`);
      return { port, name, accepts: accepted.map(outputClass) };
    }),
    outputs: entry.outputs.map(({ port, name, class: id }) => ({ port, name, type: outputClass(id) })),
  };
}

/**
 * Port-types design sections 5 and 7: the ports of the catalog of World Machine's build, if one of `catalogs` is. The build
 * is read at each call: only a start reads `system info` (world-machine-session.ts), so callers ask after a read
 * (port-types plan decision D6).
 */
export class WorldMachinePortTypes implements PortTypeCatalogPort {
  readonly #session: Pick<WorldMachineSessionPort, 'status'>;
  readonly #catalogs: readonly SourcedPortTypeCatalog[];

  constructor(session: Pick<WorldMachineSessionPort, 'status'>, catalogs: readonly SourcedPortTypeCatalog[]) {
    this.#session = session;
    this.#catalogs = catalogs;
  }

  portsOf(deviceType: string): CataloguedPorts | undefined {
    const catalog = this.#current();
    const entry = catalog === undefined ? undefined : own(catalog.types, deviceType);
    return catalog === undefined || entry === undefined ? undefined : resolvePorts(catalog, entry);
  }

  portsOfAdded(addSpelling: string): CataloguedPorts | undefined {
    const catalog = this.#current();
    const entry =
      catalog === undefined
        ? undefined
        : Object.values(catalog.types).find((candidate) => candidate.added.includes(addSpelling));
    return catalog === undefined || entry === undefined ? undefined : resolvePorts(catalog, entry);
  }

  catalogInUse(): CatalogSource | undefined {
    return this.#selected()?.source;
  }

  /** The catalog of the build World Machine runs. */
  #current(): PortTypeCatalog | undefined {
    return this.#selected()?.catalog;
  }

  #selected(): SourcedPortTypeCatalog | undefined {
    return selectCatalog(this.#catalogs, this.#session.status().systemInfo?.build);
  }
}

/**
 * Port-types design section 6: a device whose ports pass the domain's fingerprint gets each output's class name as
 * `type`, each input's accepted class names as `accepts`, and `portTypes: 'catalogued'`; any other device keeps its
 * ports as read and gets `portTypes: 'unknown'`.
 */
export function attachPortTypes(detail: DeviceDetail, catalogued: CataloguedPorts | undefined): DeviceDetail {
  const typed = typedPorts(detail, catalogued);
  if (typed === undefined) return { ...detail, portTypes: 'unknown' };
  return {
    ...detail,
    inputs: detail.inputs.map((input, index) => ({
      ...input,
      accepts: at(typed.inputs, index).accepts.map((accepted) => accepted.name),
    })),
    outputs: detail.outputs.map((output, index) => ({ ...output, type: at(typed.outputs, index).type.name })),
    portTypes: 'catalogued',
  };
}
