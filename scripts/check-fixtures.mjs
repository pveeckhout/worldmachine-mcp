#!/usr/bin/env node
// Fails when a fixture contains a personal path or licence text. Fixtures are published with the repo.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const FORBIDDEN = [
  /\/home\//,
  /\/Users\//,
  /\/root\//,
  /C:\\Users\\/i,
  /licen[cs]e/i,
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/,
  /\/tmp\//,
  /\/var\/folders\//,
];
const root = process.argv[2] ?? 'test/fixtures';

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else yield path;
  }
}

let violations = 0;
if (existsSync(root)) {
  for (const file of files(root)) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        if (FORBIDDEN.some((pattern) => pattern.test(line))) {
          violations++;
          process.stderr.write(`${file}:${index + 1}: ${line}\n`);
        }
      });
  }
}
process.exit(violations === 0 ? 0 : 1);
