# worldmachine-mcp design: enum options in get_device

Date: 2026-10-12
Status: draft, awaiting review
Builds on: [v1 design](2026-10-04-worldmachine-mcp-design.md) (`get_device`, `update_device_parameters`, facts 18, 28, 33, 35, the session's `system info` read) and [v3 design](2026-10-06-worldmachine-mcp-v3-design.md) (facts 79 and 81, plan decision D1). Backlog: lowlands trial, "a client cannot learn an enum's options" (docs/research/2026-10-05-plan1-backlog.md).

## 1. Purpose and scope

A client sets an enum by its 0-based index (`update_device_parameters`, graph specs), but `get_device` shows only the current label. In the lowlands trial the client learned Combiner `Method` and Advanced Perlin `Style` by setting indexes until World Machine refused one, each probe an unsaved change; it found 4 of Method's 11 options and 2 of Style's 9.

This design adds the options to `get_device`: each `enum` row carries its labels in index order, taken from a catalog captured once from World Machine build 4067 and shipped with the server. Nothing is probed at runtime.

In scope: the capture, the catalog and its generator, attaching options in the World Machine adapter's device reader, the `get_device` view, and tool descriptions.

Out of scope: labels as input to `update_device_parameters` or graph specs, comparing enums in `plan_graph` (plan decision D1 stands: enums are given by index and planned with `comparable: false`), listing options in error messages, and a runtime probe.

## 2. Facts this design rests on

- Fact 83 (raw/help.txt `help param`): the console has no command that lists an enum's options. `param list` shows an enum row's current label only (`  Method                    enum      Average`, raw/enum-options.txt l.1558).
- Fact 84 (raw/p2c-edits.txt l.217-222, raw/create-water-isolation.txt l.335-350): `param set` with an index past the last option is refused with `Error: Error: Enum index out of range (0-<last>): <index>`, and a `param get` afterwards shows the value unchanged. Whether the refused set adds an undo step or marks the project unsaved is not captured; nothing in this design depends on it.
- Fact 85 (raw/enum-options.txt, capture `enum-options`, 2026-10-12, build 4067): each of the 118 device types of raw/v3-rename-types.txt was added alone to a new project; its enum rows were probed with index 9999 for the range and then set to every index and read back with `param get`. 68 types hold 111 enum parameters. The label at index `i` is the `param get` value after `param set ... <i>` (Combiner `Method`: 0 `Average`, 1 `Add`, 2 `Subtract`, 3 `Multiply`, 4 `Max`, 5 `Min`, ..., l.1572-1602, eleven in all). `param get` may print trailing whitespace after a label (`#559.Method = Add `, l.1578); the `param list` parser drops trailing whitespace (`parsers/param-list.ts`), so catalog labels are stored without it.
- Fact 86 (raw/enum-options.txt l.1806-1809 and l.7941-7944): two enum parameters have no options. The refusal reads `Enum index out of range (0--1): 9999`, and the value reads as `0`. The catalog records them with an empty option list.
- `device info` acts on the selected device, not on an argument (v1 design, section 5: `get_device` runs `device select` first). The capture's `device info #<id>` lines therefore show the selection and are not used. The catalog key is the new device's listed type from its `device list` row (fact 81: the kind in the row, or its name when the two are equal), which for a device just added is the type `device info` reports (fact 79) and so the type `get_device` returns.

## 3. Catalog

### Capture

The `enum-options` scenario of `scripts/capture-fixtures.mjs` (commit e79f969) produces `test/fixtures/wm-4067/raw/enum-options.txt`. A re-capture on another build writes `test/fixtures/wm-<build>/raw/enum-options.txt`.

### Data file

`scripts/build-enum-catalog.mjs <transcript>` parses the transcript and prints the catalog, written to `src/adapter/out/worldmachine/enum-options.4067.json`:

```json
{
  "build": 4067,
  "types": {
    "Combiner": { "Method": ["Average", "Add", "Subtract", "Multiply", "Max", "Min", "..."] }
  }
}
```

- `build` comes from the transcript's `system info` (`Version: Build <n>`), never from a constant.
- A type is keyed by the listed type of its new device (section 2). Parameter names are as `param list` prints them.
- Options are in index order, index 0 first; their count is the range error's `<last> + 1` (fact 84). An index whose `param get` is missing or unreadable makes the generator fail rather than write a gap.
- A type without enum parameters is omitted. A parameter with range `(0--1)` has `[]` (fact 86).
- The generator's parser lives in one module used by both the script and the parity test.

### Parity

A test parses `raw/enum-options.txt` with the generator's parser and asserts it deep-equals `enum-options.4067.json`, so the shipped data cannot drift from its transcript.

## 4. Attaching options

`WorldMachineGraphReader.getDevice` already reads `device info`, `param list`, and `wire list`. After parsing, for each `enum` row it attaches `options` when all of these hold:

1. the session's `system info` build (`status().systemInfo.build`) equals the catalog's `build`;
2. the catalog has an entry for the device's type (as `device info` reports it) and for the row's parameter name;
3. the row's current value is one of that entry's options.

Otherwise the row has no `options`, and the device detail lists why, one note per distinct reason, in this wording:

- `enum options omitted: the catalog is from build 4067, World Machine is build <n>` (once per device, when rule 1 fails; rules 2 and 3 are then not checked);
- `no enum options known for type '<type>'` (rule 2, type missing);
- `no enum options known for '<parameter>' of type '<type>'` (rule 2, parameter missing);
- `'<parameter>' shows '<value>', which the catalog does not list; its options are omitted` (rule 3; this also covers fact 86's empty lists and a device at an older version whose options differ).

A device without `enum` rows gets no note. When the session holds no `system info` (it is read at start, so this is not expected), rule 1 fails with `World Machine is build unknown`.

Domain: `Parameter` gains `options?: readonly string[]`; `DeviceDetail` gains `enumOptionsNote?: readonly string[]`. Both are set only by the adapter. `planId` (v3 section 5) hashes device details, so it now covers `options`; for one build and catalog it stays deterministic.

```mermaid
sequenceDiagram
  actor Client
  participant MCP as get_device tool
  participant Q as get-device query service
  participant R as WorldMachineGraphReader (adapter)
  participant S as WorldMachineSession
  participant C as enum-options.4067.json
  Client->>MCP: get_device(device)
  MCP->>Q: getDevice
  Q->>R: getDevice(reference)
  R->>S: device select, device info, param list, wire list
  R->>S: status().systemInfo.build
  R->>C: options of (type, parameter)
  Note over R: attach when the build matches, the entry exists,<br/>and the current value is listed; otherwise a note
  R-->>Q: DeviceDetail
  Q-->>Client: device view with options and enumOptionsNote
```

## 5. MCP surface

- The `get_device` view schema admits `options` (array of strings) on a parameter row and `enumOptionsNote` (array of strings) on the device.
- `get_device` description: an enum row lists its options in index order when the server's catalog covers the device; `enumOptionsNote` says why options are missing.
- `update_device_parameters` description: an enum takes the 0-based index of its label in `get_device`'s `options`.
- `plan_graph` description: the same sentence for enum values in a spec.

## 6. Testing

- Generator parser: the range line (including `(0--1)`), labels with trailing whitespace, index order, a missing `param get` failing the parse, the build from `system info`, the type from the `device list` row; excerpts of raw/enum-options.txt as input.
- Parity: the transcript parses to exactly the committed JSON.
- Reader, through the fake World Machine: build matches and the value is listed (options attached); build differs (no options, the build note); type not in the catalog; parameter not in the catalog; value not listed; a device without enums (no note).
- The fake reports build 4067 in `system info`, and every enum row it serves shows a label the catalog lists for that type and parameter, or the test that relies on it says otherwise.
- MCP: the view schema accepts the new fields; descriptions name `options`.
- Live (`WM_LIVE=1`, after the user approves the run): `get_device` of a Combiner shows `Method` with the eleven captured options.

## 7. Documentation

README: `get_device` (options and the note) and `update_device_parameters` (index of a label in `options`). Backlog: the lowlands item becomes `Done:`.
