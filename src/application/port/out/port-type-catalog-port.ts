import type { CatalogSource, PortRef, WireVerdict } from '../../../domain/catalog.js';
import type { CataloguedPorts } from '../../../domain/port-types.js';

/**
 * Port-types design section 7: the ports `device add` creates for a device type, with their classes, captured once
 * per World Machine build. Queries only: they send no command. Both answer undefined when World Machine's build is not
 * the catalog's.
 */
export interface PortTypeCatalogPort {
  /** A device the project holds, by the type `device info` reports (facts 79 and 81); the caller applies the fingerprint. */
  portsOf(deviceType: string): CataloguedPorts | undefined;
  /**
   * A device a plan adds, by the word it is added with: only a spelling the capture added exactly (Codex round 1
   * ruling B1), since another spelling of the same listed type is not known to give the same device.
   */
  portsOfAdded(addSpelling: string): CataloguedPorts | undefined;
  /** The catalog type key of the entry `portsOfAdded` finds for the spelling; undefined when it finds none. */
  typeOfAdded(addSpelling: string): string | undefined;
  /**
   * What World Machine's recorded verdict says of a pair of ports, from the corrections of the running build. Only a
   * sample-derived catalog is corrected; a strict one, and a pair without a verdict, give undefined.
   */
  correctionOf(output: PortRef, input: PortRef): WireVerdict | undefined;
  /** Whether the catalog in use is sample-derived and its build has at least one correction. */
  hasCorrections(): boolean;
  /** The source of the catalog selected for the running build; undefined when none applies. */
  catalogInUse(): CatalogSource | undefined;
  /** Startup problems with local catalog files, each naming its file; empty when there are none. */
  problems(): readonly string[];
}
