#!/usr/bin/env node
// Prints the port-type catalog of the `port-types` transcripts of one build (port-types design section 4, plan
// decision D16); several transcripts, such as a run that crashed and its `port-types-resume` run, are merged (design
// section 3, crashes and resumes). The build comes from the `system info` capture beside the first transcript,
// test/fixtures/wm-<build>/raw/system-info.txt, never from a constant; the class names from the names map, the one
// argument ending in `.json`, when one is given.
// node scripts/build-port-type-catalog.mjs test/fixtures/wm-4067/raw/port-types.txt
//   test/fixtures/wm-4067/raw/port-types-resume.txt scripts/port-type-names.4067.json
//   > src/adapter/out/worldmachine/port-types.4067.json
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parsePortTypeCatalog } from './port-type-catalog.mjs';

const args = process.argv.slice(2);
const namesPaths = args.filter((arg) => arg.endsWith('.json'));
const transcripts = args.filter((arg) => !arg.endsWith('.json'));
if (transcripts.length === 0 || namesPaths.length > 1) {
  process.stderr.write('usage: node scripts/build-port-type-catalog.mjs <transcript>... [names.json]\n');
  process.exit(2);
}
const [namesPath] = namesPaths;
try {
  const catalog = parsePortTypeCatalog(
    transcripts.map((transcript) => readFileSync(transcript, 'utf8')),
    readFileSync(join(dirname(transcripts[0]), 'system-info.txt'), 'utf8'),
    namesPath === undefined ? {} : JSON.parse(readFileSync(namesPath, 'utf8')),
  );
  process.stdout.write(`${JSON.stringify(catalog, null, 2)}\n`);
} catch (error) {
  // Nothing on stdout, so a redirect into the catalog file never receives a partial catalog.
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
