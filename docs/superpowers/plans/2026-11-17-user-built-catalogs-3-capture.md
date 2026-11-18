# User-built catalogs, plan 3 of 3: capturing a catalog from the server

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans (reference: ~/.claude/superpowers-refs/executing-plans.md) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user on a build without a catalog starts a `short` or `full` capture through an MCP tool. It runs in the
background, can be followed, cancelled, and resumed, and installs its catalogs into the local folder only after they
validate.

**Architecture:** The pure capture logic (transcript format, enum and port-type parsers, probe verdicts) moves from
`scripts/` into `src/adapter/out/worldmachine/capture/`, and the scripts become thin wrappers over the built code.
An outbound `RunCatalogCapturePort` drives World Machine through a session lease that refuses every other tool while
it is held. The application service owns the `CatalogCapture` aggregate (one at a time), validates what the run
produced, and installs it through `InstallCatalogPort` with atomic renames. One inbound port per MCP tool (start, status, cancel) backs the capture tools.

**Tech Stack:** TypeScript 7 (ESM), Node >= 22.12, vitest 5, biome, zod 4.

**Spec:** `docs/superpowers/specs/2026-11-17-worldmachine-mcp-user-built-catalogs-design.md` (D1, D2, D2a, D3, the
install half of "Safety of catalog files", Constraints, the domain model, Ports, Sequence). Requires plans 1 and 2.

## Global Constraints

- No new dependencies. The package ships only `dist`; the capture code must live under `src/`.
- No part of the product or its scripts reads, disassembles, or extracts World Machine's binaries or install files.
  Captures, including device type discovery, talk to the console only.
- `short` (default): enum capture, then the port-type sample checked against the closest strict catalog (highest build
  below the new build, else the lowest; never a sample-derived one; corrections never applied to the base).
- `full`: enum capture, then every output wired to every input, including the twin pass.
- A capture writes into a working folder, never over live files. Before replacing anything it validates: build equals
  the running World Machine's, the run completed (no missing type, no missing pair for `full`), every type has an
  `inputs` and an `outputs` list (Library Input and Macro have empty ones in both shipped catalogs), every referenced
  class exists, and the file parses with the startup reader (plan 1 `readPortTypeCatalog`, `readEnumCatalog`).
- Replacement is an atomic rename; the replaced file is kept as `<name>.previous.json`, one generation. Installing a
  port-type catalog moves `port-type-corrections.json` to `port-type-corrections.previous.json`.
- `capture_catalog` refuses when the build has a strict catalog (shipped or local full), and refuses `short` when the
  build has any port-type catalog. A short capture whose sample disagrees never replaces a port-type catalog; it
  installs its enum catalog when that validates.
- While a capture runs, every tool that needs World Machine is refused at once with build, mode, progress, and time
  left. Nothing queues behind a capture. The server never starts a capture on its own.
- A cancelled or crashed run keeps its partial transcript; the next capture of the same build and mode resumes it. A
  capture is not a running job across a server restart or a World Machine crash.
- On 4069 and later the capture never sends `device select` (use `device info <ref>`, `deviceInfoCommands` in
  `src/adapter/out/worldmachine/device-info-read.ts`).
- Live runs open a World Machine window: ask the user before each one, tell them to keep the pointer off the window on
  4069, end with `project close force` before quitting, and check `ps -eo comm | grep ^WorldMachine` afterwards.
- Commits: Conventional Commits, subject at most 72 characters, a short message, no AI attribution.

## Review Focus

1. A capture started while `apply_graph` is half-way: the capture must refuse to start, not wait and not interleave
   (Task 7 test `refuses a lease while another tool holds the session`).
2. A resume whose working folder belongs to another build or mode (the user upgraded World Machine between runs): the
   old transcript is moved aside, never mixed in (Task 9 test `does not resume a transcript of another build`).
3. A run cancelled during install: install either finished or never started; no half-renamed folder (Task 8 test
   `an install interrupted between renames leaves a readable catalog`).
4. World Machine crashing mid-probe: the job ends `failed` with the crash, the partial transcript stays, and the next
   `capture_catalog` resumes after the crashed pair (Task 9 test `resumes after a crash`).
5. A sampled type the base lacks plus a disagreement on another type: the result names both, and no port-type file is
   written (Task 3 test `names untyped types even when the sample disagrees`).

---

### Task 1: Measure the short capture on build 4069 (live, needs approval)

**Files:**
- Modify: `test/fixtures/wm-4069/raw/enum-options.txt` (only if the re-capture is identical apart from timing; see Step 3)
- Create: `src/adapter/out/worldmachine/capture/durations.ts`

**Interfaces:**
- Produces: `export const CAPTURE_MINUTES: { readonly short: number; readonly full: number }`, rounded up to whole
  minutes, for build 4069 as measured. `short` = enum capture + 4 (the sample's adding and listing, 36 s, and lean
  probing, 178 s, from `port-types-sample.txt` `(timing)`). `full` = enum capture + 1 + 277.

- [ ] **Step 1: Ask the user for the live run**, with: World Machine 4069 opens a window; keep the pointer off it;
  the run adds every enum type and reads its parameters.

- [ ] **Step 2: Time the enum capture**

Run: `/usr/bin/time -f '%e s' node scripts/capture-fixtures.mjs enum-options`
Expected: `captured enum-options`, then the elapsed seconds on stderr.

- [ ] **Step 3: Check the fixture and the process**

Run: `git diff --stat test/fixtures/wm-4069/raw/enum-options.txt; ps -eo comm | grep ^WorldMachine`
Expected: no leftover process. If the fixture changed, show the user the diff and ask whether to keep it or restore it
with `git checkout -- test/fixtures/wm-4069/raw/enum-options.txt`; do not decide alone, since the shipped enum catalog
must stay what that file parses to.

- [ ] **Step 4: Write `durations.ts`** with the measured values and a comment naming the date, the build, and the
  source numbers.

- [ ] **Step 5: Commit**

```bash
git add src/adapter/out/worldmachine/capture/durations.ts
git commit -m "chore(capture): record the measured capture durations"
```

### Task 2: Move the capture logic into the package

**Files:**
- Create under `src/adapter/out/worldmachine/capture/`: `transcript.ts` (`transcriptSections`, `buildOfSystemInfo`,
  `render`, and the section type), `enum-catalog.ts`, `port-type-catalog.ts`, `port-type-probe.ts`, from
  `scripts/enum-catalog.mjs`, `scripts/port-type-catalog.mjs`, `scripts/port-type-probe.mjs`, and `render` in
  `scripts/capture-fixtures.mjs` (l.246).
- Modify: those three `.mjs` files to `export * from '../dist/adapter/out/worldmachine/capture/<name>.js';`
- Delete: `scripts/enum-catalog.d.mts`, `scripts/port-type-catalog.d.mts`, `scripts/port-type-probe.d.mts`
- Modify: `test/scripts/enum-catalog.test.ts`, `test/scripts/port-type-catalog.test.ts`,
  `test/scripts/port-type-probe.test.ts`, `test/scripts/derive-port-type-catalog.test.ts` (import from `src/`),
  `scripts/capture-fixtures.mjs` (header: run `npm run build` first)
- Create: `src/adapter/out/worldmachine/capture/wire-list.ts` from `scripts/wire-list.mjs` (`port-type-probe` and
  `port-type-catalog` import it), and make `scripts/wire-list.mjs` a wrapper and delete `scripts/wire-list.d.mts` as
  for the others; `test/scripts/wire-list.test.ts` imports from `src/`.

**Interfaces:**
- Produces: the same exported names and behaviour as the scripts today, typed (the deleted `.d.mts` files give the
  types). `PortTypeCatalogData` becomes an alias of `PortTypeCatalog` (`src/domain/catalog.ts`, plan 1).

- [ ] **Step 1: Move the tests' imports to the new paths**

Run: `npx vitest run test/scripts`
Expected: FAIL, modules not found.

- [ ] **Step 2: Move the code, unchanged in behaviour; convert to TypeScript with the types of the `.d.mts` files**

- [ ] **Step 3: Run the full check, which builds `dist` before the script CLI tests spawn**

Run: `npm run check`
Expected: PASS, including `the shipped build 4069 port-type catalog` parity and `check:fixtures`.

- [ ] **Step 4: Confirm the script entry points still run**

Run: `node scripts/derive-port-type-catalog.mjs src/adapter/out/worldmachine/port-types.4067.json test/fixtures/wm-4069/raw/port-types-sample.txt | diff - src/adapter/out/worldmachine/port-types.4069.json`
Expected: no output (stderr shows the omitted types and moved words as today).

- [ ] **Step 5: Commit**

```bash
git add scripts src/adapter/out/worldmachine/capture test/scripts
git commit -m "refactor(capture): move the capture parsers into the package"
```

### Task 3: The sample check as an outcome, and the base it checks against

**Files:**
- Modify: `src/adapter/out/worldmachine/capture/port-type-catalog.ts`, `scripts/derive-port-type-catalog.mjs`
- Modify: `src/domain/catalog.ts` (`closestStrictBase`)
- Test: `test/scripts/derive-port-type-catalog.test.ts`, `test/domain/catalog.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type SampleCheck =
    | { readonly agreed: true; readonly catalog: PortTypeCatalog; readonly omittedTypes: readonly string[]; readonly untypedTypes: readonly string[]; readonly movedWords: readonly { readonly word: string; readonly from: string; readonly to: string }[] }
    | { readonly agreed: false; readonly disagreement: string; readonly omittedTypes: readonly string[]; readonly untypedTypes: readonly string[] };
  export function checkSample(base: PortTypeCatalog, sample: string, systemInfo: string): SampleCheck;
  ```
  `disagreement` is the message `derivePortTypeCatalog` throws today for ports or a verdict. A sampled type the base
  lacks no longer throws: it goes to `untypedTypes` and gets no entry in `catalog.types`. `derivePortTypeCatalog`
  stays as a wrapper that throws `disagreement` (the script's behaviour); the script prints `untyped type '<t>': not
  in the build <b> catalog` on stderr for each.
- Produces in `src/domain/catalog.ts`:
  `export function closestStrictBase<T extends { readonly source: CatalogSource }>(candidates: readonly T[], build: number): T | undefined`
  (strict only; highest build below `build`, else the lowest build).

- [ ] **Step 1: Write the failing tests**

```ts
it('names a sampled type the base lacks instead of failing', () => {
  const { 'Create Water': _, ...types } = base.types;
  const check = checkSample({ ...base, types }, sample, systemInfo);
  expect(check).toMatchObject({ agreed: true, untypedTypes: ['Create Water'] });
  expect(check.agreed && check.catalog.types['Create Water']).toBeFalsy();
});
it('names untyped types even when the sample disagrees', () => {
  const { 'Create Water': _, ...types } = base.types;
  expect(checkSample({ ...base, types }, flippedVerdict(), systemInfo)).toMatchObject({
    agreed: false, untypedTypes: ['Create Water'], disagreement: expect.stringContaining('but the build 4067 catalog says connected'),
  });
});
// catalog.test.ts
it('takes the highest strict build below as the base', () => {
  const s = (build: number, kind: CatalogKind) => ({ source: { build, kind, origin: 'shipped' as const } });
  expect(closestStrictBase([s(4067, 'strict'), s(4069, 'sample-derived'), s(4070, 'strict')], 4071)?.source.build).toBe(4070);
  expect(closestStrictBase([s(4067, 'strict')], 4060)?.source.build).toBe(4067);
});
```

Replace the existing test `fails when the sample adds a type the base catalog lacks` with the first test above.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run test/scripts/derive-port-type-catalog.test.ts test/domain/catalog.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run the full check**

Run: `npm run check`
Expected: PASS (the parity test is unaffected: 4067 holds every type the 4069 sample added)

- [ ] **Step 5: Commit**

```bash
git add src scripts/derive-port-type-catalog.mjs test
git commit -m "feat(capture): report a sample check as agreed or disagreed"
```

### Task 4: Class names for a full run

**Files:**
- Modify: `src/adapter/out/worldmachine/capture/port-type-catalog.ts`
- Test: `test/scripts/port-type-catalog.test.ts`

**Interfaces:**
- Produces: `export function nameClasses(catalog: PortTypeCatalog, reference: PortTypeCatalog | undefined): PortTypeCatalog`.
  A class keeps the name of the reference class with exactly the same `Type.Output` members; otherwise it is named
  `class <id>: <first three members joined by ', '>` plus `, ...` when there are more. Ids are unchanged.

- [ ] **Step 1: Write the failing tests**

```ts
it('names classes after the reference catalog', () => {
  const unnamed = parsePortTypeCatalog(transcripts, systemInfo); // no names map
  expect(nameClasses(unnamed, PORT_TYPE_CATALOG_4067).outputClasses).toStrictEqual(PORT_TYPE_CATALOG_4067.outputClasses);
});
it('generates a name for a class the reference lacks', () => {
  const named = nameClasses(unnamed, { ...PORT_TYPE_CATALOG_4067, outputClasses: {} });
  expect(Object.values(named.outputClasses)[0]).toMatch(/^class \S+: .+/);
});
```

(Use the transcripts this test file already parses for the 4067 catalog. `outputClasses` maps an id such as `o1` to
its name; a class's members are the `Type.Output` entries of `types` whose output `class` is that id.)

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run test/scripts/port-type-catalog.test.ts`
Expected: FAIL, `nameClasses` is not exported.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/scripts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/adapter/out/worldmachine/capture test/scripts
git commit -m "feat(capture): name the classes of a full run"
```

### Task 5: Discovering device types

**Files:**
- Modify: `src/domain/catalog.ts` (`DeviceType`)
- Create: `src/adapter/out/worldmachine/capture/discovery.ts`
- Test: `test/domain/catalog.test.ts`, `test/adapter/out/worldmachine/capture/discovery.test.ts`

**Interfaces:**
- Produces in `src/domain/catalog.ts`:
  ```ts
  export type DeviceType = { readonly addName: string; readonly aliases: readonly string[]; readonly reached: boolean };
  /** Throws when an alias names another type of the list (spec D2a invariant). */
  export function checkDeviceTypes(types: readonly DeviceType[]): void;
  ```
- Produces in `discovery.ts`:
  ```ts
  export type Discovery = {
    readonly types: readonly DeviceType[];
    readonly notReached: readonly string[]; // known types not added on this build
    /** false on a build without the ambiguity error (4067 and earlier): only the known lists were used. */
    readonly listedByConsole: boolean;
    readonly sections: readonly Section[]; // for the transcript
  };
  export async function discoverDeviceTypes(
    execute: (commands: readonly string[]) => Promise<readonly RawResponse[]>,
    seeds: { readonly addWords: readonly string[]; readonly typeNames: readonly string[] },
  ): Promise<Discovery>;
  export function ambiguousMatches(line: string): readonly string[] | undefined;
  ```
- Console replies (4069 fixtures): success `Added '<name>'`; `Error: Error: Tag '<word>' matches multiple devices: A, B`;
  `Cannot add hidden device type.`; `Device type not found`. Order: every seed add word and type name as a tag, then
  every name a reply listed that is not yet added, by its own name. A listed name whose add gives a device whose
  kind in `device list` is an already reached type becomes an alias of that type (on 4069 `Rescale (Clamp)` is a
  Clamp). Hidden types are dropped. Batches of at most 20 adds, each followed by `device delete` of what it added, so
  the blank project stays small.

- [ ] **Step 1: Write the failing tests**

```ts
it('reads the device names of an ambiguity error', () => {
  expect(ambiguousMatches("Error: Error: Tag 'File Output' matches multiple devices: Height Output, VDM Output")).toEqual(['Height Output', 'VDM Output']);
});
it('adds a listed type by its own name', async () => { /* scripted replies: 'Brightness' ambiguous with 'Levels'; then 'Levels' added */ });
it('keeps a name that adds an existing type as its alias', async () => { /* 'Rescale (Clamp)' adds a Clamp: types has Clamp with aliases ['Rescale (Clamp)'] */ });
it('names known types it did not reach', async () => { /* seed 'VDM Noise' refused: notReached ['VDM Noise'] */ });
it('falls back to the known lists without the ambiguity error', async () => { /* no reply lists names: listedByConsole false */ });
it('rejects an alias that names another type', () => {
  expect(() => checkDeviceTypes([{ addName: 'Clamp', aliases: ['Levels'], reached: true }, { addName: 'Levels', aliases: [], reached: true }])).toThrow(/alias 'Levels' of 'Clamp' names another type/);
});
```

(The scripted `execute` answers from a map of command to reply lines, the pattern of the existing adapter tests.)

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run test/domain/catalog.test.ts test/adapter/out/worldmachine/capture/discovery.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src test
git commit -m "feat(capture): discover device types through the console"
```

### Task 6: The capture aggregate and its refusals

**Files:**
- Create: `src/domain/catalog-capture.ts`
- Test: `test/domain/catalog-capture.test.ts`

**Interfaces:**
- Consumes: `CatalogSource` (plan 1).
- Produces:
  ```ts
  export type CaptureMode = 'short' | 'full';
  export type CapturePhase = 'discover' | 'enum' | 'sample' | 'probe' | 'validate' | 'install';
  export type CaptureOutcome =
    | { readonly kind: 'installed'; readonly installed: readonly ('enum-options' | 'port-types')[]; readonly notes: readonly string[] }
    | { readonly kind: 'sample-disagreed'; readonly disagreement: string; readonly installed: readonly 'enum-options'[]; readonly notes: readonly string[] }
    | { readonly kind: 'failed'; readonly reason: string }
    | { readonly kind: 'cancelled' };
  export type CaptureProgress = { readonly phase: CapturePhase; readonly done: number; readonly total: number };
  export class CatalogCapture {
    constructor(build: number, mode: CaptureMode, startedAt: Date);
    progress(progress: CaptureProgress, now: Date): void;
    finish(outcome: CaptureOutcome): void;
    /** Linear in done units of the current phase, plus the remaining phases' fixed estimates; undefined before any unit. */
    minutesLeft(now: Date): number | undefined;
    view(now: Date): CaptureView; // build, mode, phase, percent, minutesLeft, outcome?
  }
  export function captureRefusal(mode: CaptureMode, existing: readonly CatalogSource[], build: number): string | undefined;
  export function busyMessage(view: CaptureView): string;
  // e.g. "World Machine is capturing the catalog of build 4071 (short, sample, 40%, about 4 min left); try again later or cancel_catalog_capture"
  ```
- Domain events are log lines written by the service (Task 9): `CatalogCaptureStarted`, `CatalogCaptureProgressed`
  (once per phase change), `CatalogCaptureFinished` with the outcome kind.

- [ ] **Step 1: Write the failing tests**

```ts
it('refuses any capture when the build has a strict catalog', () => {
  expect(captureRefusal('full', [{ build: 4067, kind: 'strict', origin: 'shipped' }], 4067)).toMatch(/build 4067 already has a strict catalog/);
});
it('refuses a short capture when the build has any port-type catalog', () => {
  expect(captureRefusal('short', [{ build: 4069, kind: 'sample-derived', origin: 'shipped' }], 4069)).toMatch(/full/);
});
it('allows a full capture over a sample-derived catalog', () => {
  expect(captureRefusal('full', [{ build: 4069, kind: 'sample-derived', origin: 'shipped' }], 4069)).toBeUndefined();
});
it('estimates the time left from progress', () => {
  const c = new CatalogCapture(4071, 'short', t(0));
  c.progress({ phase: 'sample', done: 50, total: 100 }, t(60_000));
  expect(c.view(t(60_000)).percent).toBeGreaterThan(0);
  expect(c.minutesLeft(t(60_000))).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run test/domain/catalog-capture.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement; phase weights for the estimate come from `CAPTURE_MINUTES` (Task 1)**

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/domain/catalog-capture.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domain/catalog-capture.ts test/domain/catalog-capture.test.ts
git commit -m "feat(capture): model a catalog capture and its refusals"
```

### Task 7: The session lease

**Files:**
- Modify: `src/domain/errors.ts` (ErrorCode `CAPTURING`)
- Modify: `src/application/port/out/world-machine-session-port.ts`, `src/adapter/out/worldmachine/world-machine-session.ts`
- Test: `test/adapter/out/worldmachine/world-machine-session.test.ts`

**Interfaces:**
- Produces on `WorldMachineSessionPort`:
  ```ts
  /** Takes the session for one long job. Throws REFUSED while another call is in flight or exclusive work runs. */
  lease(busy: () => string): SessionLease;
  export interface SessionLease {
    execute(commands: readonly string[], timeoutMs?: number): Promise<readonly RawResponse[]>;
    /** Binds a fresh, clean project after `project new blank force`. */
    bindFresh(): void;
    release(): void;
  }
  ```
- While a lease is held, `assertAcceptingCalls`, `execute`, `executeOne`, `ensureRunning`, and `exclusive` called by
  anyone else throw `WorldMachineError('CAPTURING', busy())`. `status()` still answers. The idle timer does not stop
  World Machine while a lease is held. A second `lease` throws `CAPTURING`.

- [ ] **Step 1: Write the failing tests** (the file's fake-process pattern)

```ts
it('refuses other calls while a lease is held', async () => {
  const lease = session.lease(() => 'capturing build 4071');
  await expect(session.executeOne('system info')).rejects.toMatchObject({ code: 'CAPTURING', message: 'capturing build 4071' });
  lease.release();
  await expect(session.executeOne('system info')).resolves.toBeDefined();
});
it('refuses a lease while another tool holds the session', async () => {
  const held = session.exclusive(() => new Promise(() => {}));
  expect(() => session.lease(() => '')).toThrow(expect.objectContaining({ code: 'REFUSED' }));
});
it('runs the lease holder\'s commands', async () => { /* lease.execute(['system info']) answers */ });
it('keeps World Machine running past the idle timeout during a lease', async () => { /* fake timers */ });
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run test/adapter/out/worldmachine/world-machine-session.test.ts`
Expected: FAIL, `lease` is not a function.

- [ ] **Step 3: Implement; add `lease` to every session stub in `test/` (throwing `not used`)**

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src test
git commit -m "feat(session): lease the session to one long job"
```

### Task 8: Installing a captured catalog

**Files:**
- Create: `src/application/port/out/install-catalog-port.ts`
- Create: `src/adapter/out/fs/fs-catalog-installer.ts`
- Test: `test/adapter/out/fs/fs-catalog-installer.test.ts`

**Interfaces:**
- Consumes: `readPortTypeCatalog`, `readEnumCatalog` (plan 1 `catalog-reader.ts`), `writeFileAtomic` (plan 2).
- Produces:
  ```ts
  export type CaptureRecord = {
    readonly mode: CaptureMode; readonly date: string; readonly serverVersion: string;
    readonly baseBuild?: number; readonly sampleCheck?: 'agreed' | string; // the disagreement
    readonly notCaptured: readonly string[]; readonly untypedTypes: readonly string[];
    readonly discoveryIncomplete: boolean; readonly deviceTypes: readonly DeviceType[];
  };
  export type CatalogInstall = {
    readonly build: number;
    readonly enumOptions?: EnumCatalog;
    readonly portTypes?: PortTypeCatalog;
    readonly record: CaptureRecord;
  };
  export interface InstallCatalogPort {
    /** Validates, then installs. Throws Error naming the first failed check; nothing live changes then. */
    install(entry: CatalogInstall, runningBuild: number): void;
  }
  export class FsCatalogInstaller implements InstallCatalogPort { constructor(directory: string); }
  ```
- Order: validate both catalogs (build equals `runningBuild` and `entry.build`; each passes the startup reader after a
  JSON round trip), write each new file into `<dir>/<build>/.install/` (atomic), then per file: rename the live one to
  `<name>.previous.json` (replacing an older `.previous`), rename the new one into place. A port-type install moves the
  corrections aside through `RetirePortTypeCorrectionsPort.retire(build)` (below), never by renaming the file itself.
  `capture.json` is written last.
- Amendment (plan 2 final review, Important 3): the corrections store owns its file. Add
  `src/application/port/out/retire-port-type-corrections-port.ts` with
  `export interface RetirePortTypeCorrectionsPort { retire(build: number): void; }`, implemented by
  `FsPortTypeCorrections`: rename `port-type-corrections.json` to `port-type-corrections.previous.json` (replacing an
  older one; ENOENT is a no-op), then drop the build's in-memory entries, failure mark, and problems.
  `FsCatalogInstaller` takes the port as a constructor argument; `main.ts` passes the one shared `FsPortTypeCorrections`.
  Extra tests: `retire` leaves only the `.previous` file and `correctionsFor(build)` is undefined; a corrupt
  corrections file is moved aside too, and `record` works again afterwards.

- [ ] **Step 1: Write the failing tests**

```ts
it('installs into an empty build folder', () => { /* expect enum-options.json, port-types.json, capture.json */ });
it('keeps the replaced catalog as previous', () => { /* install twice; port-types.previous.json equals the first */ });
it('moves the corrections aside with a new port-type catalog', () => { /* corrections file present before; after: only .previous */ });
it('refuses a catalog of another build and changes nothing', () => {
  expect(() => installer.install({ ...entry, portTypes: { ...catalog, build: 4069 } }, 4071)).toThrow(/build 4069, but World Machine is build 4071/);
  expect(readdirSync(join(dir, '4071'))).toEqual(before);
});
it('an install interrupted between renames leaves a readable catalog', () => {
  // make the second rename fail (a directory named port-types.json.new in the way, or inject rename): the live
  // folder holds either the old or the new port-types.json, and FsLocalCatalogs (plan 1) loads it without a problem
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run test/adapter/out/fs/fs-catalog-installer.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement; take `renameSync` as an optional constructor parameter for the interruption test**

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/adapter/out/fs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/application/port/out/install-catalog-port.ts src/adapter/out/fs test/adapter/out/fs
git commit -m "feat(capture): validate and install a captured catalog"
```

### Task 8a: The live catalog registry (amendment, plan 1 final review Important 2)

Spec Goal 3 and the sequence diagram (the installed catalog answers the next call): an install must take effect
without a restart. Plan 1 hands catalog arrays to `WorldMachinePortTypes` and `WorldMachineGraphReader` once, at
startup.

**Files:**
- Create: `src/adapter/out/worldmachine/catalog-registry.ts`
- Create: `src/application/port/out/register-catalogs-port.ts`
- Modify: `src/adapter/out/worldmachine/world-machine-port-types.ts`, `src/adapter/out/worldmachine/world-machine-graph-reader.ts`, `src/main.ts`
- Test: `test/adapter/out/worldmachine/catalog-registry.test.ts`, plus one test each in the port-types and graph-reader tests

**Interfaces:**
- Produces:
  ```ts
  export interface RegisterCatalogsPort {
    /** Replaces the local catalogs of `build` with these and clears that build's local load problems. */
    add(build: number, catalogs: { readonly enumOptions?: EnumCatalog; readonly portTypes?: SourcedPortTypeCatalog }): void;
  }
  export class CatalogRegistry implements RegisterCatalogsPort {
    constructor(portTypes: readonly SourcedPortTypeCatalog[], enums: readonly EnumCatalog[], problems: readonly string[]);
    portTypeCatalogs(): readonly SourcedPortTypeCatalog[];
    enumCatalogs(): readonly EnumCatalog[];
    problems(): readonly string[];
  }
  ```
- `WorldMachinePortTypes` and `WorldMachineGraphReader` read the registry on every call instead of holding arrays
  (constructor takes the registry; keep an array overload or a `CatalogRegistry` built from arrays for the existing
  tests). Shipped catalogs are never replaced; selection rules (plan 1 `selectCatalog`, shipped enum wins) unchanged.
- A problem line belongs to a build when it starts with `<catalogDir>/<build>/`; `add` drops those lines only.
- `CatalogCaptureService` (Task 9) calls `add` after a successful install, with the same objects it installed.

- [ ] **Step 1: Write the failing tests**

```ts
it('a catalog added after startup answers the next lookup', () => {
  const registry = new CatalogRegistry([], [], []);
  const portTypes = new WorldMachinePortTypes(sessionAt(4071), registry);
  expect(portTypes.catalogInUse()).toBeUndefined();
  registry.add(4071, { portTypes: localShort4071 });
  expect(portTypes.catalogInUse()).toMatchObject({ build: 4071, origin: 'local' });
});
it('clears the load problems of the added build only', () => { /* problems for 4071 and 4072; add 4071; only 4072's remain */ });
it('never replaces a shipped catalog', () => { /* add a local 4067 port-type catalog: catalogInUse on 4067 stays shipped strict */ });
it('the graph reader attaches enum options added after startup', async () => { /* enum catalog for 4071 added later appears in get_device */ });
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run test/adapter/out/worldmachine`
Expected: FAIL

- [ ] **Step 3: Implement; `main.ts` builds one registry from the shipped and local catalogs and passes it to both adapters**

- [ ] **Step 4: Run the full check**

Run: `npm run check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src test
git commit -m "feat(catalog): make installed catalogs live without a restart"
```

### Task 9: Running a capture

**Files:**
- Create: `src/application/port/out/run-catalog-capture-port.ts`
- Create: `src/adapter/out/worldmachine/capture/world-machine-catalog-capturer.ts`
- Create: `src/application/port/in/command/start-catalog-capture-command.ts`,
  `src/application/port/in/command/cancel-catalog-capture-command.ts`,
  `src/application/port/in/query/get-catalog-capture-status-query.ts`
- Create: `src/application/service/catalog-capture-service.ts`
- Test: `test/adapter/out/worldmachine/capture/world-machine-catalog-capturer.test.ts`,
  `test/application/service/catalog-capture-service.test.ts`

**Interfaces:**
- Produces (out port):
  ```ts
  export type CaptureRun = {
    readonly build: number; readonly mode: CaptureMode;
    readonly base?: PortTypeCatalog; // short only, from closestStrictBase
    readonly known: { readonly addWords: readonly string[]; readonly typeNames: readonly string[] };
    readonly workDir: string; // <catalogDir>/<build>/.capture-<mode>
  };
  export type CaptureResult = {
    readonly enumOptions: EnumCatalog;
    readonly portTypes: SampleCheck | { readonly agreed: true; readonly catalog: PortTypeCatalog }; // full: parsed and named
    readonly discovery: Discovery;
    readonly refusedWords: readonly string[];
  };
  export interface RunCatalogCapturePort {
    run(run: CaptureRun, lease: SessionLease, onProgress: (p: CaptureProgress) => void, signal: AbortSignal): Promise<CaptureResult>;
  }
  ```
- The capturer: `project new blank force`, then `lease.bindFresh()`; discovery (Task 5), the enum capture (the
  `enumOptions` scenario of `scripts/capture-fixtures.mjs` l.3433, with discovered types added to `ENUM_TYPES` and
  `ADD_BY_NAME`), then the sample (`portTypesBody` with `sample` and `lean`) or the full probe (`portTypesBody`, then
  `addTwins`), each batch appended to `<workDir>/<phase>.txt` in the `render` format as it completes, with
  `<workDir>/resume.json` = `{ build, mode, serverVersion }`. The crash bookkeeping of `portTypesBody` (`crashedTarget`,
  the `crashed` verdict) is kept; a World Machine crash ends the run with `failed`, and the next run resumes. It ends
  with `project close force` and `project new blank force`, then `bindFresh()`. `signal` is checked between batches.
- Produces (inbound ports, one per file):
  ```ts
  export type StartCatalogCaptureCommand = { readonly mode: CaptureMode; readonly discardOpenProject: boolean };
  export interface StartCatalogCapturePort { start(command: StartCatalogCaptureCommand): Promise<CaptureView>; }
  export type CancelCatalogCaptureCommand = Record<string, never>;
  export interface CancelCatalogCapturePort { cancel(command: CancelCatalogCaptureCommand): Promise<CaptureView | null>; }
  export type GetCatalogCaptureStatusQuery = Record<string, never>;
  export interface GetCatalogCaptureStatusPort { status(query: GetCatalogCaptureStatusQuery): Promise<CaptureView | null>; }
  ```
- `CatalogCaptureService` implements all of these ports: `start` ensures World Machine runs (for the build), refuses with
  `captureRefusal`, refuses `REFUSED` when the session is dirty and `discardOpenProject` is false (the message says the
  open project is closed first), takes the lease, starts `run` without awaiting it, and returns the first view. When
  `run` settles it validates and installs per the outcome rules (agreed: both files; disagreed: enum only;
  full: both), registers what it installed through `RegisterCatalogsPort.add` (Task 8a), releases the lease, and keeps the finished `CatalogCapture` for `status` until the next start.
  The service takes `onEvent: (name: string, fields: Record<string, unknown>) => void` as its last constructor
  argument; `main.ts` passes one that logs at `info`, so the application layer needs no logger.
  `<workDir>` is removed after an install; a `resume.json` of another build or mode is renamed to
  `.capture-<mode>.stale-<time>` before a run starts.

- [ ] **Step 1: Write the failing tests** (capturer against scripted replies cut from `test/fixtures/wm-4069/raw/enum-options.txt` and `port-types-sample.txt`; service with fake ports)

```ts
// capturer
it('captures a short run from the 4069 fixtures', async () => {
  const result = await capturer.run(shortRun4069, scriptedLease, () => {}, new AbortController().signal);
  for (const [type, entry] of Object.entries(ENUM_CATALOG_4069.types)) expect(result.enumOptions.types[type]).toStrictEqual(entry);
  expect(result.portTypes).toMatchObject({ agreed: true });
});
it('sends no device select on 4069', async () => { expect(sent.some((c) => c.startsWith('device select'))).toBe(false); });
it('resumes after a crash', async () => { /* first run's lease crashes after N batches; second run sends none of the first N batches */ });
it('does not resume a transcript of another build', async () => { /* resume.json build 4069 in 4071's workDir: renamed .stale-*, fresh run */ });
// service
it('refuses a start while a capture runs', async () => { await expect(service.start(short)).rejects.toMatchObject({ code: 'CAPTURING' }); });
it('refuses when the open project has unsaved changes', async () => { /* dirty session, discardOpenProject false: REFUSED */ });
it('installs only enum options when the sample disagrees', async () => { /* installer receives no portTypes; outcome sample-disagreed */ });
it('cancels between batches and keeps the transcript', async () => { /* cancel(): outcome cancelled; workDir still there */ });
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run test/adapter/out/worldmachine/capture test/application/service/catalog-capture-service.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement; port the scenario functions to the lease's `execute` (they use `run(commands, ms)` today,
  whose sections are what `lease.execute` returns per command), and keep `MAX_RESTARTS` out: the server does not
  restart World Machine inside a run**

- [ ] **Step 4: Run the full check**

Run: `npm run check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src test
git commit -m "feat(capture): run a catalog capture in the background"
```

### Task 10: The MCP tools and the capture offer

**Files:**
- Modify: `src/adapter/in/mcp/create-server.ts`, `src/adapter/in/mcp/schemas.ts`, `src/main.ts`
- Modify: `src/domain/catalog.ts` (`CatalogInfo.capture`)
- Test: `test/adapter/in/mcp/create-server.test.ts`, `test/domain/catalog.test.ts`

**Interfaces:**
- Consumes: the three inbound ports (Task 9), `CAPTURE_MINUTES` (Task 1).
- Tools (annotations as the existing ones: status read-only, the other two not):
  - `capture_catalog` `{ mode?: 'short' | 'full' (default 'short'), discardOpenProject?: boolean (default false) }`
  - `catalog_capture_status` `{}` returns the view or `{ capture: null }`
  - `cancel_catalog_capture` `{}`
- `CatalogInfo` gains `readonly capture?: string`, set by `catalogInfo` when `portTypes` is `none` and the build is
  known: `No catalog for build <b>. capture_catalog can capture one: short (about <s> min) or full (about <f> min).
  World Machine is busy for the whole run and closes the open project first; keep the mouse pointer off its window.`
- Descriptions say: a capture runs in the background; every tool that needs World Machine is refused until it ends;
  the server never starts one on its own.

- [ ] **Step 1: Write the failing tests**

```ts
it('offers a capture on an uncatalogued build', () => {
  expect(catalogInfo(4071, undefined, [], false).capture).toMatch(/^No catalog for build 4071\. capture_catalog/);
});
it('makes no offer when a catalog is in use', () => {
  expect(catalogInfo(4069, sampleDerivedShipped, [], false).capture).toBeUndefined();
});
it('registers the capture tools', async () => {
  expect(toolNames).toEqual(expect.arrayContaining(['capture_catalog', 'catalog_capture_status', 'cancel_catalog_capture']));
});
it('returns CAPTURING as a tool error while a capture runs', async () => { /* list_devices with a session that throws CAPTURING: isError, code CAPTURING */ });
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run test/adapter/in/mcp/create-server.test.ts test/domain/catalog.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement and wire in `main.ts`: `FsCatalogInstaller(config.catalogDir)`,
  `WorldMachineCatalogCapturer`, `CatalogCaptureService`; read the server version from `package.json` the way
  `create-server.ts` names the server, or pass it in**

- [ ] **Step 4: Run the full check**

Run: `npm run check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src test
git commit -m "feat(capture): add the catalog capture tools"
```

### Task 11: Documentation and a live short capture (live, needs approval)

**Files:**
- Modify: `README.md` (a "Catalogs for other builds" section: the offer, the modes and their durations, the busy
  refusal, cancel and resume, the folder and `.previous` files, that discovery may miss types and why)
- Create: `test/live/catalog-capture.live.test.ts` (gated by `WM_LIVE=1` like the others)

**Interfaces:**
- The live test points `WORLD_MACHINE_CATALOG_DIR` at a temp folder. On 4069 `short` is refused (the shipped
  catalog is sample-derived), so the test constructs `CatalogCaptureService` with no shipped catalogs for 4069, runs a
  `short` capture, waits for the outcome by polling `status`
  every 10 s up to 30 min, and expects `installed` with `port-types` and a sample check `agreed`.

- [ ] **Step 1: Write the README section**

- [ ] **Step 2: Write the live test**

- [ ] **Step 3: Ask the user for the live run** (pointer off the window; about `CAPTURE_MINUTES.short` minutes)

Run: `WM_LIVE=1 npx vitest run test/live/catalog-capture.live.test.ts`
Expected: PASS; then `ps -eo comm | grep ^WorldMachine` prints nothing.

- [ ] **Step 4: Run the full check**

Run: `npm run check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add README.md test/live/catalog-capture.live.test.ts
git commit -m "docs(readme): describe capturing catalogs for other builds"
```
