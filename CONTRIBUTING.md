# Contributing

## Supporting a new World Machine build

The parsers are tested against recorded console transcripts in `test/fixtures/wm-<build>/`. To add a build:

1. Install that World Machine build with a licence that allows `--cli`.
2. Run `WORLD_MACHINE_BIN=/path/to/world-machine npm run capture-fixtures`. World Machine opens a window, runs the
   scripted scenarios against scratch projects in a temporary directory, and closes.
3. Run `npm run check:fixtures`. It fails if a transcript contains a home directory path or licence text. Fix the
   `scrub()` function in `scripts/capture-fixtures.mjs` rather than editing transcripts by hand.
4. Compare the new `raw/` transcripts with the previous build's. Where the output format changed, add a parser test
   using the new transcript, then change the parser.
5. Open a pull request with the transcripts, the tests, and the parser changes.

## Development

`npm run check` runs typecheck, lint, tests, and the fixture check. Tests use a fake World Machine
(`test/fake-wm/fake-wm.mjs`) and never need a licence. Tests against a real installation run only with
`WM_LIVE=1 WORLD_MACHINE_BIN=/path/to/world-machine npx vitest run test/live`.
