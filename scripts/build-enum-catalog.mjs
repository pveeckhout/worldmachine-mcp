#!/usr/bin/env node
// Prints the enum catalog of an `enum-options` transcript (enum-options design section 3). The build comes from the
// `system info` capture beside it, test/fixtures/wm-<build>/raw/system-info.txt (ruling 1), never from a constant.
// node scripts/build-enum-catalog.mjs test/fixtures/wm-4067/raw/enum-options.txt
//   > src/adapter/out/worldmachine/enum-options.4067.json
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseEnumCatalog } from './enum-catalog.mjs';

const transcript = process.argv[2];
if (transcript === undefined) {
  process.stderr.write('usage: node scripts/build-enum-catalog.mjs <transcript>\n');
  process.exit(2);
}
try {
  // Ruling 1: the build comes from the `system info` capture of the same fixture directory.
  const catalog = parseEnumCatalog(
    readFileSync(transcript, 'utf8'),
    readFileSync(join(dirname(transcript), 'system-info.txt'), 'utf8'),
  );
  process.stdout.write(`${JSON.stringify(catalog, null, 2)}\n`);
} catch (error) {
  // Nothing on stdout, so a redirect into the catalog file never receives a partial catalog.
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
