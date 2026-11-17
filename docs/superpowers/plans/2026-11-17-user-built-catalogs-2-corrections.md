# User-built catalogs, plan 2 of 3: corrections from World Machine's verdicts

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans (reference: ~/.claude/superpowers-refs/executing-plans.md) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When World Machine accepts or refuses a wire against what a sample-derived catalog predicted, the server
records the verdict for that pair of ports, and the next plan uses it.

**Architecture:** The wire editor reports, for every connect it sends, the typed ends and what the catalog predicted
(on success in the returned `WireConnection`, on an `incompatible types?` refusal in the error's details). A pure
domain function decides whether the verdict is recorded, only reported, or ignored. `ConnectDevicesService` and
`ApplyGraphService` pass each verdict through one application helper that calls `RecordPortTypeCorrectionPort`. A
file-system adapter keeps the corrections per build, in memory and in `port-type-corrections.json`, and
`checkWireTypes` asks for a correction before it compares classes.

**Tech Stack:** TypeScript 7 (ESM), Node >= 22.12, vitest 5, biome, zod 4.

**Spec:** `docs/superpowers/specs/2026-11-17-worldmachine-mcp-user-built-catalogs-design.md` (D6, the corrections lines
of D4 and "Safety of catalog files", `PortTypeCorrection` and `WireVerdictContradictedCatalog` in the domain model).
Requires plan 1 (`CatalogSource`, `catalogInUse()`, `CatalogInfo`, `FsLocalCatalogs`, `catalogDir`).

## Global Constraints

- No new dependencies. No part of the product reads World Machine's binaries or install files.
- Corrections apply to sample-derived catalogs only. A strict catalog is never corrected; a contradicting verdict is
  reported in the tool result and logged, and nothing is written.
- Corrections are keyed per pair of ports, `Type.Output` to `Type.Input` (device type and port name on both ends), never
  by class.
- No correction when either end is a device that may take its type from its inputs: Chooser, Combiner, Layers, and Router;
  the verdict is then reported in the tool result only. A wire with an untyped end has no prediction to contradict,
  so its verdict is neither recorded nor reported.
- Sources of verdicts: `apply_graph` and `connect_devices`. Each correction is logged with build, pair, verdict, and
  tool.
- Every change to `port-type-corrections.json` is a whole-file atomic write (temp file in the same folder, then
  rename). A corrupt corrections file is reported at startup and ignored, never deleted or overwritten.
- The shipped 4069 catalog is never edited; its corrections go to `<catalogDir>/4069/`.
- Commits: Conventional Commits, subject at most 72 characters, a short message, no AI attribution.

## Review Focus

1. A corrupt `port-type-corrections.json` followed by a refused wire: the file must not be overwritten with a fresh
   one holding only the new entry, since that deletes what the user could still repair (Task 3 test
   `does not write over a corrections file that failed to load`).
2. The same pair refused, then accepted later (World Machine changed its mind, or a flaky reply): the last verdict wins
   (Task 3 test `the last verdict of a pair wins`).
3. A connect that World Machine refuses for a reason other than `incompatible types?` (port not found, loop): no
   verdict at all (Task 4 test `attaches no typing to another refusal`).
4. `apply_graph` failing on a refused wire: the refusal is still recorded before the snapshot is restored and
   APPLY_FAILED is thrown (Task 5 test `records a refusal even though the apply fails`).
5. A wire between a Combiner and a typed device on a sample-derived catalog: reported, never recorded (Task 2 test
   `never records a pair with an adaptive end`).

---

### Task 1: The correction model

**Files:**
- Modify: `src/domain/catalog.ts`
- Test: `test/domain/catalog.test.ts`

**Interfaces:**
- Produces in `src/domain/catalog.ts`:
  ```ts
  export type PortRef = { readonly type: string; readonly port: string }; // device type, port name
  export type WireVerdict = 'accepted' | 'refused';
  export type VerdictSource = 'apply_graph' | 'connect_devices';
  export type PortTypeCorrection = {
    readonly build: number;
    readonly output: PortRef;
    readonly input: PortRef;
    readonly verdict: WireVerdict;
    readonly source: VerdictSource;
    readonly at: string; // ISO time
  };
  /** `Type.Output`, as in port-type-names.4067.json. */
  export function portKey(ref: PortRef): string;
  export function pairKey(output: PortRef, input: PortRef): string; // `${portKey(output)}->${portKey(input)}`
  /** The verdict per pair; a later correction of the same pair replaces an earlier one. */
  export function correctionIndex(corrections: readonly PortTypeCorrection[]): ReadonlyMap<string, WireVerdict>;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
const water = { type: 'Create Water', port: 'Water System' };
const output = { type: 'Height Output', port: 'Input' };
it('keys a pair by type and port name', () => {
  expect(pairKey(water, output)).toBe('Create Water.Water System->Height Output.Input');
});
it('the last verdict of a pair wins in the index', () => {
  const c = (verdict: WireVerdict) => ({ build: 4069, output: water, input: output, verdict, source: 'apply_graph' as const, at: '' });
  expect(correctionIndex([c('refused'), c('accepted')]).get(pairKey(water, output))).toBe('accepted');
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run test/domain/catalog.test.ts`
Expected: FAIL, `pairKey` is not exported.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/domain/catalog.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domain/catalog.ts test/domain/catalog.test.ts
git commit -m "feat(catalog): model port-type corrections per pair"
```

### Task 2: Judging a verdict

**Files:**
- Modify: `src/domain/catalog.ts`
- Test: `test/domain/catalog.test.ts`

**Interfaces:**
- Consumes: `CatalogKind` (plan 1), `PortRef`, `WireVerdict` (Task 1), `WireCompatibility` (`src/domain/port-types.ts`).
- Produces:
  ```ts
  export const ADAPTIVE_TYPES: ReadonlySet<string>; // Chooser, Combiner, Layers, Router
  /** What the connect showed: both ends' refs when typed, the catalog's prediction (with corrections applied). */
  export type WireTyping = {
    readonly output: PortRef | undefined;
    readonly input: PortRef | undefined;
    readonly predicted: WireCompatibility;
  };
  export type VerdictReport = {
    readonly pair: string; // pairKey, or the ends as far as known
    readonly verdict: WireVerdict;
    readonly predicted: 'compatible' | 'incompatible';
    readonly outcome: 'recorded' | 'reported';
    /** Why it was only reported: 'strict catalog' or 'adaptive device'. Absent when recorded. */
    readonly reason?: string;
  };
  /** undefined when World Machine agreed with the prediction, or the wire was unchecked with no typed end at all. */
  export function judgeVerdict(kind: CatalogKind | undefined, typing: WireTyping, verdict: WireVerdict): VerdictReport | undefined;
  ```
  Rules, in order: agreement (`accepted` with `compatible`, `refused` with `incompatible`) gives `undefined`;
  `predicted` `unchecked` gives `undefined` (no prediction to contradict); an end in `ADAPTIVE_TYPES` gives
  `reported`/`adaptive device`; `kind` `strict` gives `reported`/`strict catalog`; otherwise `recorded`. With
  `predicted` other than `unchecked` both ends are typed by construction. A wire with an untyped end has no prediction,
  so World Machine's verdict contradicts nothing: it is neither recorded nor reported (designer reading of D6's
  untyped-end rule).

- [ ] **Step 1: Write the failing tests**

```ts
const typed = (predicted: WireCompatibility) => ({ output: water, input: output, predicted });
it('records a refusal the sample-derived catalog called compatible', () => {
  expect(judgeVerdict('sample-derived', typed('compatible'), 'refused')).toMatchObject({ outcome: 'recorded', verdict: 'refused' });
});
it('records an acceptance the sample-derived catalog called a conflict', () => {
  expect(judgeVerdict('sample-derived', typed('incompatible'), 'accepted')).toMatchObject({ outcome: 'recorded' });
});
it('says nothing when World Machine agrees', () => {
  expect(judgeVerdict('sample-derived', typed('compatible'), 'accepted')).toBeUndefined();
});
it('only reports a contradiction of a strict catalog', () => {
  expect(judgeVerdict('strict', typed('compatible'), 'refused')).toMatchObject({ outcome: 'reported', reason: 'strict catalog' });
});
it('never records a pair with an adaptive end', () => {
  const fed = { output: { type: 'Combiner', port: 'Output' }, input: output, predicted: 'compatible' as const };
  expect(judgeVerdict('sample-derived', fed, 'refused')).toMatchObject({ outcome: 'reported', reason: 'adaptive device' });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run test/domain/catalog.test.ts`
Expected: FAIL, `judgeVerdict` is not exported.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/domain/catalog.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domain/catalog.ts test/domain/catalog.test.ts
git commit -m "feat(catalog): judge World Machine's verdict on a wire"
```

### Task 3: The corrections file

**Files:**
- Create: `src/application/port/out/record-port-type-correction-port.ts`
- Create: `src/application/port/out/port-type-corrections-port.ts` (the read side)
- Create: `src/adapter/out/fs/fs-port-type-corrections.ts`
- Create: `src/adapter/out/fs/atomic-write.ts`
- Test: `test/adapter/out/fs/fs-port-type-corrections.test.ts`

**Interfaces:**
- Consumes: `PortTypeCorrection`, `correctionIndex` (Task 1); `Logger` (`src/logger.ts`).
- Produces:
  ```ts
  export interface RecordPortTypeCorrectionPort { record(correction: PortTypeCorrection): void; }
  export interface PortTypeCorrectionsPort {
    /** undefined when the build has no corrections, or its file failed to load. */
    correctionsFor(build: number): ReadonlyMap<string, WireVerdict> | undefined;
    /** One line per corrections file that failed to load: path and reason. */
    problems(): readonly string[];
  }
  export function writeFileAtomic(path: string, text: string): void; // write `<path>.<pid>.tmp`, then renameSync
  export class FsPortTypeCorrections implements RecordPortTypeCorrectionPort, PortTypeCorrectionsPort {
    constructor(directory: string, logger: Logger);
  }
  ```
- File: `<directory>/<build>/port-type-corrections.json` =
  `{ "build": 4069, "corrections": [ { "output": "Type.Output", "input": "Type.Input", "verdict": "refused", "source": "apply_graph", "at": "<ISO>" } ] }`,
  appended in order. The folder is created on the first record (`mkdirSync(..., { recursive: true })`).
- Loads every build folder's file in the constructor (synchronous, startup only). A record for a build whose file
  failed to load throws `Error('port-type corrections for build <b> were not loaded: <path>; fix or move the file')`;
  the caller turns that into a `reported` outcome (Task 5).
- Each record logs at `info`: `port-type correction: build 4069, Create Water.Water System -> Height Output.Input refused (apply_graph)`.

- [ ] **Step 1: Write the failing tests** (each in its own `mkdtempSync` folder)

```ts
it('writes a correction and reads it back after a restart', () => {
  new FsPortTypeCorrections(dir, logger).record(refused);
  expect(new FsPortTypeCorrections(dir, logger).correctionsFor(4069)?.get(pairKey(water, output))).toBe('refused');
});
it('the last verdict of a pair wins', () => { /* record refused, then accepted; expect 'accepted' after reload */ });
it('reports a corrupt file and ignores it', () => {
  write('4069/port-type-corrections.json', '{');
  const store = new FsPortTypeCorrections(dir, logger);
  expect(store.correctionsFor(4069)).toBeUndefined();
  expect(store.problems()).toEqual([expect.stringContaining('4069/port-type-corrections.json')]);
});
it('does not write over a corrections file that failed to load', () => {
  write('4069/port-type-corrections.json', '{');
  expect(() => new FsPortTypeCorrections(dir, logger).record(refused)).toThrow(/were not loaded/);
  expect(read('4069/port-type-corrections.json')).toBe('{');
});
it('leaves no temp file behind', () => { /* record; readdirSync(4069) equals ['port-type-corrections.json'] */ });
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run test/adapter/out/fs/fs-port-type-corrections.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the ports, `writeFileAtomic`, and the adapter; validate each loaded entry (two keys with one
  `.`, a known verdict and source) and treat the first bad entry as a corrupt file**

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/adapter/out/fs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/application/port/out src/adapter/out/fs test/adapter/out/fs
git commit -m "feat(catalog): keep port-type corrections per build"
```

### Task 4: The wire editor reports what the catalog predicted

**Files:**
- Modify: `src/domain/graph-edit.ts` (`WireConnection`)
- Modify: `src/adapter/out/worldmachine/world-machine-wire-editor.ts` (`connect`, `#incompatible`, `#plan`)
- Test: `test/adapter/out/worldmachine/world-machine-wire-editor.test.ts`

**Interfaces:**
- Consumes: `WireTyping` (Task 2), `wireCompatibility`, `typedPorts` (`src/domain/port-types.ts`),
  `PortTypeCatalogPort.catalogInUse()` (plan 1).
- Produces: `WireConnection` gains `readonly typing?: WireTyping` (present on a created wire when a catalog is in use
  for the build). The `WM_COMMAND_FAILED` error of an `incompatible types?` refusal gains
  `details: { typing: WireTyping }` (fourth constructor argument of `WorldMachineError`).
- Cost: on success the editor needs the source's port names, so it sends one extra `wire list #<source>`, only when a
  catalog is in use and the destination input is typed (the refusal path already reads it). Read it before the
  `wire connect`, so the prediction does not depend on the wire existing.
- The prediction uses the class comparison with the build's corrections applied (Task 6 puts the corrected comparison
  in `src/domain/port-types.ts` as `correctedCompatibility`; this task uses `wireCompatibility` and Task 6 swaps it).

- [ ] **Step 1: Write the failing tests** (the file's existing scripted-session pattern, build 4069)

```ts
it('reports the typed ends and the prediction of a created wire', async () => {
  const wire = await editor.connect(gradientOut, heightOutputIn);
  expect(wire.typing).toStrictEqual({ output: { type: 'Gradient', port: 'Output' }, input: { type: 'Height Output', port: 'Input' }, predicted: 'compatible' });
});
it('carries the typing on an incompatible-types refusal', async () => {
  await expect(editor.connect(waterOut, heightOutputIn)).rejects.toMatchObject({ details: { typing: { predicted: expect.any(String) } } });
});
it('attaches no typing to another refusal', async () => {
  // reply `Error: Error: Input port not found on '#2'`
  await expect(editor.connect(a, b)).rejects.not.toHaveProperty('details.typing');
});
it('reads no source wire list when no catalog is in use', async () => { /* build 4071: expect the sent commands unchanged from today */ });
```

(Use port names from `port-types.4069.json`; pick a pair that the catalog calls compatible and one it calls
incompatible.)

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run test/adapter/out/worldmachine/world-machine-wire-editor.test.ts`
Expected: FAIL, `typing` undefined.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domain/graph-edit.ts src/adapter/out/worldmachine/world-machine-wire-editor.ts test/adapter/out/worldmachine
git commit -m "feat(wires): report the catalog's prediction for each connect"
```

### Task 5: Recording verdicts from connect_devices and apply_graph

**Files:**
- Create: `src/application/service/wire-verdicts.ts`
- Modify: `src/application/service/connect-devices-service.ts`, `src/application/service/apply-graph-service.ts`
- Modify: `src/application/port/in/command/connect-devices-command.ts`, `src/application/port/in/command/apply-graph-command.ts`
- Modify: `src/adapter/in/mcp/schemas.ts`, `src/adapter/in/mcp/create-server.ts` (`connect_devices`, `apply_graph`
  descriptions), `src/main.ts`
- Test: `test/application/service/wire-verdicts.test.ts`, `test/application/service/apply-graph-service.test.ts`,
  `test/application/service/connect-devices-service.test.ts` (create it if absent)

**Interfaces:**
- Consumes: `judgeVerdict`, `VerdictReport` (Task 2), `RecordPortTypeCorrectionPort` (Task 3),
  `WireConnection.typing` and the refusal's `details.typing` (Task 4), `catalogInUse()` (plan 1).
- Produces:
  ```ts
  export class WireVerdicts {
    constructor(portTypes: PortTypeCatalogPort, corrections: RecordPortTypeCorrectionPort, now: () => Date = () => new Date());
    /** Judges and records; a record that throws turns the outcome into 'reported' with the error message as reason. */
    observe(typing: WireTyping | undefined, verdict: WireVerdict, source: VerdictSource): VerdictReport | undefined;
    /** For a caught error: the refused verdict when it carries details.typing, otherwise undefined. */
    observeRefusal(error: unknown, source: VerdictSource): VerdictReport | undefined;
  }
  ```
- `ConnectDevicesView` gains `readonly verdict?: VerdictReport`. A refused connect still throws; the error's
  `details` gain `verdict` when there is one, so the MCP failure result carries it (the existing `details` mechanism of
  `WorldMachineError`).
- `ApplyGraphView` gains `readonly verdicts: readonly VerdictReport[]` (empty when none). On a failing connect step
  the refusal is observed before the restore, and `APPLY_FAILED`'s details gain `verdicts`.
- Schema for `VerdictReport`: `z.strictObject({ pair: z.string(), verdict: z.enum(['accepted','refused']), predicted: z.enum(['compatible','incompatible']), outcome: z.enum(['recorded','reported']), reason: z.string().optional() })`.

- [ ] **Step 1: Write the failing tests**

```ts
// wire-verdicts.test.ts, with an in-memory RecordPortTypeCorrectionPort and a port-types stub at 4069 sample-derived
it('records a contradicting verdict with build, pair, source, and time', () => {
  verdicts.observe(typed('compatible'), 'refused', 'connect_devices');
  expect(recorded).toEqual([{ build: 4069, output: water, input: output, verdict: 'refused', source: 'connect_devices', at: '2026-11-17T00:00:00.000Z' }]);
});
it('reports instead of recording when the store refuses', () => {
  const report = new WireVerdicts(portTypes, throwingStore, now).observe(typed('compatible'), 'refused', 'apply_graph');
  expect(report).toMatchObject({ outcome: 'reported', reason: expect.stringContaining('were not loaded') });
});
// apply-graph-service.test.ts
it('lists the verdicts of an apply', async () => { expect((await apply(warningSpec)).verdicts).toHaveLength(1); });
it('records a refusal even though the apply fails', async () => {
  await expect(apply(refusedSpec)).rejects.toMatchObject({ code: 'APPLY_FAILED' });
  expect(recorded).toHaveLength(1);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run test/application/service`
Expected: FAIL, `WireVerdicts` not found.

- [ ] **Step 3: Implement; wire `FsPortTypeCorrections(config.catalogDir, logger)` in `main.ts`; tool descriptions
  say that on a sample-derived catalog a verdict contradicting the catalog is recorded for that pair of ports and
  listed, and on a strict catalog only listed**

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src test
git commit -m "feat(wires): record World Machine's verdicts on sample-derived catalogs"
```

### Task 6: Plans use the corrections

**Files:**
- Modify: `src/domain/port-types.ts` (add `correctedCompatibility`)
- Modify: `src/application/port/out/port-type-catalog-port.ts`, `src/adapter/out/worldmachine/world-machine-port-types.ts`
- Modify: `src/application/service/wire-types.ts`, `src/adapter/out/worldmachine/world-machine-wire-editor.ts`
- Modify: `src/domain/catalog.ts` (`catalogInfo` sets `corrections`), `src/main.ts`
- Test: `test/domain/port-types.test.ts`, `test/application/service/wire-types.test.ts`,
  `test/adapter/out/worldmachine/world-machine-port-types.test.ts`

**Interfaces:**
- Consumes: `PortTypeCorrectionsPort` (Task 3), `pairKey` (Task 1).
- Produces on `PortTypeCatalogPort`: `correctionOf(output: PortRef, input: PortRef): WireVerdict | undefined` (from the
  corrections of the running build, only when the catalog in use is sample-derived). `WorldMachinePortTypes` takes the
  `PortTypeCorrectionsPort` as a constructor argument; its `problems()` (plan 1) now also returns the corrections'
  problems.
- Produces in `src/domain/port-types.ts`:
  `export function correctedCompatibility(compatibility: WireCompatibility, correction: WireVerdict | undefined): WireCompatibility`
  (`accepted` gives `compatible`, `refused` gives `incompatible`, `undefined` or `unchecked` input unchanged).
- A refused correction makes `checkWireTypes` give a type finding (a warning, plan 1 Task 6) with the reason
  `'<src>' output <n> (<class>) cannot feed '<dst>' input <m>: World Machine refused this pair on build <b>`.
- `CatalogInfo.corrections` is `true` when the catalog in use is sample-derived and its build has at least one
  correction.

- [ ] **Step 1: Write the failing tests**

```ts
it('a refused correction turns a compatible wire into a warning', () => {
  const check = checkWireTypes(spec, state, steps, sampleDerivedWith({ [pairKey(water, output)]: 'refused' }));
  expect(check.warnings).toEqual([{ entry: expect.any(String), reason: expect.stringContaining('World Machine refused this pair on build 4069') }]);
});
it('an accepted correction clears a warning', () => {
  expect(checkWireTypes(spec, state, conflictSteps, sampleDerivedWith({ [key]: 'accepted' })).warnings).toEqual([]);
});
it('ignores corrections on a strict catalog', () => {
  expect(strictWith({ [key]: 'accepted' }).correctionOf(water, output)).toBeUndefined();
});
it('says corrections apply', () => {
  expect(catalogInfo(4069, sampleDerivedShipped, [], true).corrections).toBe(true);
});
```

(`catalogInfo` gains a fourth parameter, `hasCorrections: boolean`; update plan 1's callers.)

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run test/domain test/application/service/wire-types.test.ts test/adapter/out/worldmachine/world-machine-port-types.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement; the wire editor's prediction (Task 4) switches to `correctedCompatibility`**

- [ ] **Step 4: Run the full check**

Run: `npm run check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src test
git commit -m "feat(plan): apply recorded port-type corrections"
```

### Task 7: Documentation

**Files:**
- Modify: `README.md` (the port-types bullet)

- [ ] **Step 1: Add to the port-types bullet:** on a sample-derived catalog (4069, local short),
  a wire World Machine accepts or refuses against the catalog is recorded for that pair of ports in
  `<catalog folder>/<build>/port-type-corrections.json` and used by later plans; Chooser, Combiner, Layers, and Router
  ends are never recorded; on 4067 a contradiction is only listed.

- [ ] **Step 2: Run the full check**

Run: `npm run check`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(readme): describe port-type corrections"
```
