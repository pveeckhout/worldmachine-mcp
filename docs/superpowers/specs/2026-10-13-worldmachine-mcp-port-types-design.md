# worldmachine-mcp design: port types from a captured catalog

Date: 2026-10-13
Status: draft, awaiting review
Builds on: [enum-options design](2026-10-12-worldmachine-mcp-enum-options-design.md) (a catalog captured once per build, attached only when the build and the device version match) and [v3 design](2026-10-06-worldmachine-mcp-v3-design.md) (`plan_graph`, `apply_graph`, the graph read, conflicts). Backlog: lowlands trial, "port types are invisible before connecting" (docs/research/2026-10-05-plan1-backlog.md l.104).

## 1. Purpose and scope

`connect_devices` is the only way to learn that a File Output refuses Create Water's `Water System`, or that Create Water's `Existing Water` refuses a heightfield or a mask. World Machine answers `Failed to create connection (incompatible types?)` and names no type. A `plan_graph` spec with such a wire has no conflict, and `apply_graph` fails part way through.

This design captures, once per World Machine build, which output ports each input port accepts, and uses it in two places: `get_device` shows each port's type, and `plan_graph` reports an incompatible wire as a conflict, so `apply_graph` refuses the spec before changing anything.

In scope: a `port-types` capture scenario, a catalog generator with a curated names map, the catalog for build 4067, a domain module, an outbound port and its adapter, the graph reader, the wire editor's refusal text, `PlanGraphService`, the view schemas, tool text, the fake World Machine, and the README.

Out of scope: a pre-check in `connect_devices` (World Machine stays the authority there; a refused connect changes nothing); listing the ports of a type that is not in the project; probing at call time; builds other than 4067 until a capture exists for them.

## 2. Facts this design rests on

- The console reports no port type. `wire list #<id>` lists ports by number and name with their links (raw/erosion-water-input.txt l.44-55); `device info` shows name, type, enabled, and bypass (raw/build-not-built.txt l.106-112); `help wire` lists `connect`, `disconnect`, and `list` only (raw/help.txt l.70-75).
- A refused connect prints `Error: Error: Failed to create connection (incompatible types?)` and changes nothing (raw/reach-scaling-inputs.txt l.605-638).
- A project file is a binary `TMDFile2` that the server does not parse (docs/research/2026-10-04-feasibility-findings.md l.35 and l.70).
- `device add` accepts 118 device types in build 4067 (raw/v3-rename-types.txt, phase A; scripts/capture-fixtures.mjs `ENUM_TYPES`). A console-added device can be an older version than one created in the window (River, Reach Scaling, Perlin Curve), and an older version can have other ports.
- Not captured yet: the port-type matrix itself (section 3). Until it is, whether compatibility is an equivalence of types or a wider relation (an input accepting two kinds of output) is unknown; the catalog stores a relation, so either case fits.

## 3. The capture

A new scenario `port-types` in `scripts/capture-fixtures.mjs`, run live once per build after the user approves the run, writes `test/fixtures/wm-4067/raw/port-types.txt`:

1. In a new blank project, `device add` each of the 118 types; a type that fails to add is recorded and skipped, as in `enum-options`.
2. `wire list #<id>` for every added device gives its input and output ports by number and name.
3. For every output port and every input port of a different device, `wire connect <src>.<p> <dst>.<q>`. A connect that succeeds is followed by `wire disconnect` of the same wire before the next attempt; a refusal must be the exact `incompatible types?` line, and any other answer is recorded as an error for that pair.
4. The project is closed with `project close force` at the end.

Crashes and resumes (amendment 2026-10-14, after the full run of build 4067 crashed World Machine with SIGSEGV while probing output #185.1, 157 of 173 outputs done):

- When World Machine exits during a probe batch, the pairs whose commands all answered keep their verdicts, and the pair whose command was in flight is recorded as `crashed`. The capture starts World Machine again, makes a new blank project, adds every word again, checks that the device list equals the first one (ids and types), records a `(restarted …)` section, and continues with the next pair. A run stops after 5 restarts.
- A `crashed` pair is a hole, like a pair on one device: its cell is unknown and no class rests on it.
- The scenario `port-types-resume`, with `PORT_TYPES_FROM=#<id>.<port>`, probes only that output and the outputs after it, into `raw/port-types-resume.txt`. The generator reads every transcript given. All of them must list the same devices and ports. A pair probed in two transcripts must have the same verdict. A `(probe … stopped)` section leaves its output unprobed in that transcript, so another transcript has to probe it.

The plan measures the time of a sample of types before the full run and states the expected duration to the user when asking to run it.

## 4. The catalog

`scripts/port-type-catalog.mjs` (a pure parser with types in `port-type-catalog.d.mts`) reads the transcript; `scripts/build-port-type-catalog.mjs` writes `src/adapter/out/worldmachine/port-types.4067.json` and prints nothing on stdout when it fails, so a redirect never receives a partial catalog. The build number comes from `system-info.txt` in the same fixture directory, as for enums.

- An output class is a set of output ports with the same row (the same inputs accept them); an input class is a set of input ports with the same column. The catalog stores, per device type, its input and output ports in order (number and name) with their class, and per input class the output classes it accepts.
- A pair on the same device is never probed (one instance per type), so its cell is unknown: rows and columns are compared ignoring unknown cells, and the accepts relation between two classes comes from the probed pairs. A port whose row or column matches two classes that differ elsewhere fails the generation, so a hole never decides a class.
- A pair recorded as an error (step 3) fails the generation, so no catalog rests on an unexplained answer.
- Several transcripts of one build (section 3, crashes and resumes) are merged before classes are formed; an output that no transcript probed completely fails the generation.
- Names: `scripts/port-type-names.4067.json` maps a representative port (`<type>.<output port name>`) to a name, such as `heightfield` or `water system`. A class without an entry is named by its first port in catalog order, `like <type> <port name>`. A map entry that names no output port, or two entries for one class, fail the generation. An input class is described by the names of the output classes it accepts.

## 5. When types apply

A device's ports are typed when the running build equals the catalog's build and the device's port names, inputs and outputs in order, equal the catalogued ports of its type (the version fingerprint). A device the plan adds with `device add` is typed by its type alone, since the catalog captured exactly what `device add` creates. In every other case the device is untyped and nothing is checked for its ports.

## 6. MCP surface

- `get_device`: for a typed device, each output gains `type` (its class name) and each input gains `accepts` (the names of the classes it accepts); the device gains `portTypes: 'catalogued'`. For an untyped device the port fields are absent and `portTypes` is `'unknown'`.
- `plan_graph`: a planned wire whose two ends are typed and whose output class the input class does not accept is a conflict, in the existing shape, `{ entry, reason }`, with the reason `'<src>' output <p> (<type>) cannot feed '<dst>' input <q>, which accepts <names>`. A planned wire with an untyped end is listed in a new `uncheckedWires: string[]`, by the spec entry of its destination and port.
- `apply_graph`: unchanged; it plans again and refuses on any conflict before changing the project.
- `connect_devices`: no pre-check. When World Machine refuses with `incompatible types?` and both ends are typed, the refusal message appends `: output <p> is <type>; input <q> accepts <names>`.
- Descriptions: `get_device`, `plan_graph`, and `connect_devices` each gain one sentence on port types and when they are unknown. README: one bullet.

## 7. Structure

- Domain, `src/domain/port-types.ts`, pure: the catalogued-ports type, `fingerprintMatches(ports, catalogued)`, `wireCompatibility(output, input)` returning `compatible`, `incompatible`, or `unchecked`, and the conflict and refusal texts.
- Application: a new outbound query port `PortTypeCatalogPort` with `portsOf(deviceType): CataloguedPorts | undefined` (undefined when the build does not match or the type is not catalogued). `PlanGraphService` uses it for planned and existing devices and runs the domain check.
- Adapter: `world-machine-port-types.ts` loads the catalog and checks the running build, as `enum-options.ts` does; the graph reader attaches `type`, `accepts`, and `portTypes`; the wire editor appends the types to an `incompatible types?` refusal.
- MCP: the device detail schema's ports gain optional `type` and `accepts` and the view gains `portTypes`; `planGraphViewSchema` gains `uncheckedWires`.

```mermaid
sequenceDiagram
  actor Client
  participant PG as plan_graph
  participant S as PlanGraphService
  participant G as graph read (existing)
  participant PT as PortTypeCatalogPort (new)
  Client->>PG: spec with wires
  PG->>S: planGraph
  S->>G: devices, ports, wires
  S->>PT: portsOf(type) for planned and existing devices
  PT-->>S: catalogued ports or undefined
  Note over S: domain: fingerprint, compatibility; incompatible -> conflict, untyped -> uncheckedWires
  S-->>Client: conflicts, steps, uncheckedWires
```

## 8. Testing

- Parser and generator, on synthetic transcripts: three classes with one input accepting two of them; a type that failed to add; a pair with an unexpected answer fails; a names entry that matches nothing, and two entries for one class, fail; the fallback name.
- Domain: fingerprint match and mismatch (an older version with other ports), the three compatibility answers, and the texts.
- Adapter: a build mismatch types nothing; a match types a device whose port names equal the catalog's, and not one whose names differ.
- Services, with stub ports: a conflict for an incompatible wire into a planned device and into an existing one; `uncheckedWires` for an untyped end; `apply_graph` refuses before any command; the `connect_devices` refusal names the types.
- Fake World Machine: `wire connect` refuses by a rule taken from the capture (Create Water's `Water System` into an input that does not accept it); anything not captured is marked `Assumed:`.
- MCP: the schemas admit the new fields; the descriptions name port types.
- Live (`WM_LIVE=1`, each run after the user approves it): the capture of section 3; then `plan_graph` with Create Water's `Water System` wired into a File Output reports the conflict, and `get_device` on Create Water shows its port types.

Sequencing: the parser, generator, domain, and services are built and tested on synthetic data first; the live capture runs next; the catalog and the names map are written from it last.

## 9. Documentation

README: a bullet on port types (catalogued for build 4067, unknown otherwise, checked by `plan_graph`, not by `connect_devices`). Backlog: the l.104 item becomes `Done:`.
