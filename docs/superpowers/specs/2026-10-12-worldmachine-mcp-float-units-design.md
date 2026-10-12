# worldmachine-mcp design: float values in display units

Date: 2026-10-12
Status: draft, awaiting review
Builds on: [v1 design](2026-10-04-worldmachine-mcp-design.md) (`update_device_parameters`, section 7; facts 18, 35, 37) and [enum-options design](2026-10-12-worldmachine-mcp-enum-options-design.md) (facts 83-86). Backlog: lowlands trial, "a float is set in internal units and read back in display units" (docs/research/2026-10-05-plan1-backlog.md).

## 1. Purpose and scope

`update_device_parameters` takes a float in World Machine's internal units and `param get` reads it back in display units (fact 18). The scale differs per parameter and per project, so a client learns it only from the read-back after a first set: in the lowlands trial, `0.5` for Gradient `Width` read `4 km`.

This design lets a client give a length float in metres or kilometres (`"500 m"`). The server learns the parameter's scale inside the same call, by setting it to 1, reading it, and undoing that set, then sends the converted internal value.

In scope: `update_device_parameters` input, validation, the scale probe, conversion, the result fields, the fake World Machine, tool text, and the README.

Out of scope: units in graph specs (`plan_graph`, `apply_graph`; `plan_graph` is read-only and cannot probe), units other than `m` and `km`, reporting a scale in `get_device`, and changing the meaning of a plain number.

## 2. Facts this design rests on

- Fact 87 (raw/float-scale.txt, capture `float-scale`, 2026-10-12, blank project): the new devices of the 118 types of the enum-options capture have 56 float parameters whose value shows a unit, in 28 types. Display = internal x scale, with no offset (a set of 0.25 reads a quarter of a set of 1, for all 56). Three scales: 8 km per unit (38 parameters, among them Gradient `Width`, Advanced Perlin `Maximum`, and every River length including `Bankfull Depth`), 3000 m per unit (16, among them Constant `Height`, Advanced Perlin `Elevation`, and Clamp `Range1`), and 1 (VDM Repair Surface `foldAngleDeg` in `°`, VDM to HF+Cliff `meshMinArea` in `km2`). The unit a parameter shows does not tell its scale: River `Bankfull Depth` shows `2 m` and is on the 8 km scale, Constant `Height` shows `0 m` and is on the 3000 m scale.
- Fact 88 (raw/float-scale.txt l.6008-6030 and the reads after it): the scene size does not change a scale. After `scene size 12 12` and `scene size 4 4` every probed value reads as before, and a new set of 1 at 4 km reads the same as at 8 km.
- Fact 89 (raw/float-scale-default.txt l.61-108): the vertical scale is the project's. In `project new default` Constant `Height` at 1 reads `2625 m` (blank: `3000 m`) and at 0.25 reads `656.2 m`; Gradient `Width` reads `8 km` in both. World Machine's help describes a project-wide maximum elevation set in Project Setup, stored heights being 0 to 1; the console has no command to read it (raw/help.txt l.90-96: `project` has close, new, open, redo, save, and undo only). Whether the 8 km horizontal scale is a project setting is unknown, so the design treats both scales as unknown.
- Fact 90 (raw/float-scale-undo.txt l.52-128): after `param set` to 0.25, a probe `param set` to 1, and `project undo` (`Undo performed.`), `param get` reads the 0.25 value again (`2 km`, `656.2 m`); a second `project undo` restores the value the device was added with (`8 km`, `0 m`). So undo removes the probe's step and only that step.
- `param set` refuses a unit in a float (`Error: Error: Invalid float value: 1.5 km`, raw/v6b-param-set.txt l.96-97); the conversion is the server's.
- Display values are rounded: an exact 656.25 m reads `656.2 m` (fact 89). The two scales read at 1 were exact in both projects.

## 3. Input

- A `float` parameter's value may be a string `<decimal> <unit>` or `<decimal><unit>`: a plain decimal as today (`-?\d+(\.\d+)?`), an optional single space, and `m` or `km`. Examples: `"500 m"`, `"2.5km"`, `"-4 km"`.
- A plain number, or a string that is a plain decimal, keeps today's meaning: World Machine's internal value.
- A unit is accepted only on a `float` whose current value in `param list` ends in ` m` or ` km` (or `m`/`km` directly after the number). Otherwise the item is a validation problem and the whole call is refused before anything is sent, as today:
  - a unit on a float whose value shows no `m` or `km` (`1.0`, `30.0°`, `0.0km2`): `a unit is accepted only on a float that shows m or km`;
  - a unit on another type: that type's existing problem text;
  - any other unit (`ft`, `%`, `km2`): `expected a plain decimal number in World Machine's internal units, or a length in m or km such as "500 m"`.

## 4. Apply

Validation is unchanged apart from section 3. When no item gives a unit, the call runs exactly as today.

When at least one does, a scale batch runs first, with, for each unit item in call order:

1. `param set <ref> 1`
2. `param get <ref>`: the scale, parsed as a length (`8 km` = 8000 m, `2625 m` = 2625 m);
3. `project undo`, which must print `Undo performed.`;
4. `param get <ref>`, which must equal the value `param list` showed for that parameter before the batch.

Then each unit item's internal value is `<metres given> / <scale in metres>`, written as plain decimal text (no exponent) of at most 12 significant digits, trailing zeros dropped. A value that rounds to zero at that precision is sent as `0`. Today's batch follows unchanged: per item `param set` and `param get`.

Failures:

- The probe `param set` is refused, or the read at 1 is not a length in `m` or `km`, or it reads 0: that item's outcome is `rejected` with `worldMachineMessage` set to World Machine's error text, or to `could not read the scale of '<name>': it read '<value>' at 1`. Its later steps are skipped; when the probe set was applied, its undo still runs. Other items continue.
- `project undo` is not confirmed, or the read after it differs from the listed value: the call fails with `UNEXPECTED_OUTPUT` before today's batch runs, naming the parameter, the value expected, and the value read, and saying that the parameter may be left at 1; check it with get_device and revert with undo. Nothing else is set.
- The project is marked unsaved once a probe set is applied, since undo may not restore World Machine's saved flag.

After a successful call, `undo` still reverts one parameter per call (fact 90): the probe's step is gone, and the redo entry its undo leaves is cleared by the next `param set`.

```mermaid
sequenceDiagram
  actor Client
  participant MCP as update_device_parameters
  participant S as UpdateDeviceParametersService
  participant E as WorldMachineParameterEditor (adapter)
  participant WM as World Machine console
  Client->>MCP: parameters { Width: "500 m", Seed: 3 }
  MCP->>S: updateDeviceParameters(command)
  S->>E: updateParameters(device, values)
  E->>WM: param list #id
  Note over E: validate; Width shows km, so a unit is allowed
  E->>WM: param set #id.Width 1, param get, project undo, param get
  Note over E: scale 8 km, restore confirmed, 500 m / 8000 m = 0.0625
  E->>WM: param set #id.Width 0.0625, param get, param set #id.Seed 3, param get
  E-->>S: outcomes
  S-->>Client: Width: requested 0.0625, given "500 m", scale "8 km", value "500 m"
```

## 5. Result and MCP surface

- `ParameterOutcome` gains `given?: string` (the value as the client gave it, `"500 m"`) and `scale?: string` (the read at 1, `"8 km"`), set only for an item given with a unit whose scale was read. `requested` stays the internal text sent, so it still matches World Machine's `Set <ref> = <text>` echo; `value` stays the read-back in display units.
- The `update_device_parameters` output schema admits both fields.
- The `update_device_parameters` description says that a float showing `m` or `km` also takes a length such as `"500 m"`, converted through the parameter's scale, which the call reads by setting the parameter to 1 and undoing that set; a plain number is an internal value; the read-back can differ from the length given by World Machine's display rounding.

## 6. Testing

- Domain: section 3's grammar and refusals; conversion text (`500 m` at 8 km is `0.0625`, `656.25 m` at 2625 m is `0.25`, a negative length, 12 significant digits, no exponent).
- Fake World Machine: unit floats display internal x scale, with 8 km per unit for horizontal parameters and a vertical scale of 3000 m in a blank project and 2625 m in the default one (facts 87 and 89); `project undo` reverts the last `param set` (fact 90). Every fake row and value is taken from the float-scale captures.
- Adapter, through the fake: a unit item applied (given, scale, requested, value); a mix of unit and plain items; validation refusals; a probe set that World Machine refuses; a read at 1 that is not a length; an undo whose read-back differs (the call fails before today's batch).
- MCP: the output schema accepts `given` and `scale`; the description mentions lengths.
- Live (`WM_LIVE=1`, after the user approves the run): in the default project, Gradient `Width` set to `"500 m"` reads `500 m`, Constant `Height` set to `"656.25 m"` reads `656.2 m`, and one `undo` per parameter restores each previous value.

## 7. Documentation

README: the `update_device_parameters` bullet (lengths in m or km, the probe and its undo, rounding). Backlog: the lowlands item becomes `Done:`.
