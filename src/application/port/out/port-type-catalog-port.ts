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
}
