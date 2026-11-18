import { existsSync, linkSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type {
  CatalogInstall,
  InstallCatalogPort,
} from '../../../application/port/out/install-catalog-port.js';
import type { RetirePortTypeCorrectionsPort } from '../../../application/port/out/retire-port-type-corrections-port.js';
import { readEnumCatalog, readPortTypeCatalog } from '../worldmachine/catalog-reader.js';
import { writeFileAtomic } from './atomic-write.js';

type Staged = { readonly name: string; readonly text: string };

const roundTrip = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

function checkBuild(what: string, build: number, runningBuild: number): void {
  if (build !== runningBuild) {
    throw new Error(`the ${what} is for build ${build}, but World Machine is build ${runningBuild}`);
  }
}

/** Installs into `<directory>/<build>/`: stage under `.install/`, then per file keep the live one as `.previous`. */
export class FsCatalogInstaller implements InstallCatalogPort {
  readonly #directory: string;
  readonly #corrections: RetirePortTypeCorrectionsPort;
  readonly #rename: typeof renameSync;

  constructor(
    directory: string,
    corrections: RetirePortTypeCorrectionsPort,
    rename: typeof renameSync = renameSync,
  ) {
    this.#directory = directory;
    this.#corrections = corrections;
    this.#rename = rename;
  }

  install(entry: CatalogInstall, runningBuild: number): void {
    checkBuild('capture', entry.build, runningBuild);
    const staged: Staged[] = [];
    if (entry.enumOptions !== undefined) {
      checkBuild('enum catalog', entry.enumOptions.build, runningBuild);
      const json = roundTrip(entry.enumOptions);
      readEnumCatalog(json);
      staged.push({ name: 'enum-options.json', text: `${JSON.stringify(json, null, 2)}\n` });
    }
    if (entry.portTypes !== undefined) {
      checkBuild('port-type catalog', entry.portTypes.build, runningBuild);
      const json = roundTrip(entry.portTypes);
      readPortTypeCatalog(json);
      staged.push({ name: 'port-types.json', text: `${JSON.stringify(json, null, 2)}\n` });
    }

    const folder = join(this.#directory, String(entry.build));
    const work = join(folder, '.install');
    rmSync(work, { recursive: true, force: true });
    mkdirSync(work, { recursive: true });
    for (const file of staged) writeFileAtomic(join(work, file.name), file.text);

    for (const file of staged) {
      if (file.name === 'port-types.json') this.#corrections.retire(entry.build);
      this.#replace(folder, work, file.name);
    }
    writeFileAtomic(join(folder, 'capture.json'), `${JSON.stringify(entry.record, null, 2)}\n`);
  }

  /** The live file stays in place until the new one is renamed over it, so a failure leaves one or the other. */
  #replace(folder: string, work: string, name: string): void {
    const live = join(folder, name);
    if (existsSync(live)) {
      const previous = join(folder, name.replace(/\.json$/, '.previous.json'));
      const temp = `${previous}.${process.pid}.tmp`;
      rmSync(temp, { force: true });
      linkSync(live, temp);
      this.#rename(temp, previous);
    }
    this.#rename(join(work, name), live);
  }
}
