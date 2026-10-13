#!/usr/bin/env node
// Prints the port-type catalog of a `port-types` transcript (port-types design section 4, plan decision D16). The build
// comes from the `system info` capture beside it, test/fixtures/wm-<build>/raw/system-info.txt, never from a constant;
// the class names from the names map, when one is given.
// node scripts/build-port-type-catalog.mjs test/fixtures/wm-4067/raw/port-types.txt scripts/port-type-names.4067.json
//   > src/adapter/out/worldmachine/port-types.4067.json
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parsePortTypeCatalog } from './port-type-catalog.mjs';

const [transcript, namesPath] = process.argv.slice(2);
if (transcript === undefined) {
  process.stderr.write('usage: node scripts/build-port-type-catalog.mjs <transcript> [names.json]\n');
  process.exit(2);
}
try {
  const catalog = parsePortTypeCatalog(
    readFileSync(transcript, 'utf8'),
    readFileSync(join(dirname(transcript), 'system-info.txt'), 'utf8'),
    namesPath === undefined ? {} : JSON.parse(readFileSync(namesPath, 'utf8')),
  );
  process.stdout.write(`${JSON.stringify(catalog, null, 2)}\n`);
} catch (error) {
  // Nothing on stdout, so a redirect into the catalog file never receives a partial catalog.
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
