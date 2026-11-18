#!/usr/bin/env node
// Prints the port-type catalog of a build derived from the full catalog of another build and a `port-types-sample`
// transcript of the new build (derivePortTypeCatalog in port-type-catalog.mjs). The build comes from the `system info`
// capture beside the sample, never from a constant.
// node scripts/derive-port-type-catalog.mjs src/adapter/out/worldmachine/port-types.4067.json
//   test/fixtures/wm-4069/raw/port-types-sample.txt > src/adapter/out/worldmachine/port-types.4069.json
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { derivePortTypeCatalog } from './port-type-catalog.mjs';

const [basePath, samplePath] = process.argv.slice(2);
if (basePath === undefined || samplePath === undefined) {
  process.stderr.write(
    'usage: node scripts/derive-port-type-catalog.mjs <base catalog.json> <sample transcript>\n',
  );
  process.exit(2);
}
try {
  const base = JSON.parse(readFileSync(basePath, 'utf8'));
  const { catalog, omittedTypes, untypedTypes, movedWords } = derivePortTypeCatalog(
    base,
    readFileSync(samplePath, 'utf8'),
    readFileSync(join(dirname(samplePath), 'system-info.txt'), 'utf8'),
  );
  process.stdout.write(`${JSON.stringify(catalog, null, 2)}\n`);
  // An omitted type has no port types on the new build; stderr names it, so the gap is never silent.
  for (const type of omittedTypes)
    process.stderr.write(`omitted type '${type}': the sample did not add it\n`);
  for (const type of untypedTypes)
    process.stderr.write(`untyped type '${type}': not in the build ${base.build} catalog\n`);
  for (const { word, from, to } of movedWords) {
    process.stderr.write(`moved add word '${word}': gives '${to}', not '${from}'\n`);
  }
} catch (error) {
  // Nothing on stdout, so a redirect into the catalog file never receives a partial catalog.
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
