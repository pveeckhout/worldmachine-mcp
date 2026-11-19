import type { EnumCatalog } from '../../../domain/catalog.js';
import type { DeviceDetail, Parameter } from '../../../domain/device.js';

import shipped4067 from './enum-options.4067.json' with { type: 'json' };
import shipped4069 from './enum-options.4069.json' with { type: 'json' };
import shipped4070 from './enum-options.4070.json' with { type: 'json' };

export type { EnumCatalog };

/** Shipped with the server: wm-4067/raw/enum-options.txt (fact 85). */
export const ENUM_CATALOG_4067: EnumCatalog = shipped4067;
/** Shipped with the server: wm-4069/raw/enum-options.txt, captured 2026-11-17. */
export const ENUM_CATALOG_4069: EnumCatalog = shipped4069;
/** Shipped with the server: wm-4070/raw/enum-options.txt, captured 2026-11-19 (every type as on 4069). */
export const ENUM_CATALOG_4070: EnumCatalog = shipped4070;
/** Every shipped catalog; getDevice uses the one of World Machine's build. */
export const ENUM_CATALOGS: readonly EnumCatalog[] = [
  ENUM_CATALOG_4067,
  ENUM_CATALOG_4069,
  ENUM_CATALOG_4070,
];

/** An own entry only: a catalog parsed from JSON still inherits `constructor` and `toString` from Object.prototype. */
const own = <T>(record: Readonly<Record<string, T>>, key: string): T | undefined =>
  Object.hasOwn(record, key) ? record[key] : undefined;

/**
 * Enum-options design section 4: attaches `options` to each `enum` row when one of `catalogs` is of World Machine's build,
 * the catalog has the device's type and the row's parameter, the device's parameter names equal those of a new device
 * of that type (the version fingerprint: the console reports no device version), and the row's current value is one
 * of the options. Otherwise the row stays as read and `enumOptionsNote` says why, once per distinct reason. Rule 2 is
 * checked per row before rule 3, so a type missing from the catalog keeps its own note; rule 3 is decided once per
 * device, at the first row that passed rule 2, and a mismatch skips rule 4. The first catalog of the build wins, so a
 * caller lists shipped catalogs before local ones. A device without enum rows is returned
 * unchanged. `build` is undefined when the session holds no `system info`.
 */
export function attachEnumOptions(
  detail: DeviceDetail,
  build: number | undefined,
  catalogs: readonly EnumCatalog[],
): DeviceDetail {
  if (!detail.parameters.some((parameter) => parameter.type === 'enum')) return detail;
  const catalog = catalogs.find((candidate) => candidate.build === build);
  if (catalog === undefined) {
    const builds = catalogs.map((candidate) => candidate.build).join(', ');
    return {
      ...detail,
      enumOptionsNote: [
        `enum options omitted: no catalog for World Machine build ${build ?? 'unknown'} (catalogs: ${builds})`,
      ],
    };
  }
  const entry = own(catalog.types, detail.type);
  const notes = new Set<string>();
  const sameVersion =
    entry !== undefined &&
    entry.parameters.length === detail.parameters.length &&
    entry.parameters.every((name, index) => name === detail.parameters[index]?.name);
  const parameters = detail.parameters.map((parameter): Parameter => {
    if (parameter.type !== 'enum') return parameter;
    if (entry === undefined) {
      notes.add(`no enum options known for type '${detail.type}'`);
      return parameter;
    }
    const options = own(entry.enums, parameter.name);
    if (options === undefined) {
      notes.add(`no enum options known for '${parameter.name}' of type '${detail.type}'`);
      return parameter;
    }
    if (!sameVersion) {
      notes.add(
        `enum options omitted: this '${detail.type}' has other parameters than a new '${detail.type}' (another device version)`,
      );
      return parameter;
    }
    // Fact 86's empty lists land here too: their value reads `0` (raw/enum-options.txt l.1806), which no list holds.
    if (!options.includes(parameter.value)) {
      notes.add(
        `'${parameter.name}' shows '${parameter.value}', which the catalog does not list; its options are omitted`,
      );
      return parameter;
    }
    return { ...parameter, options };
  });
  return notes.size === 0
    ? { ...detail, parameters }
    : { ...detail, parameters, enumOptionsNote: [...notes] };
}
