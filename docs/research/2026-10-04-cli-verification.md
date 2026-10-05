# World Machine CLI verification (build 4067)

Captured on 2026-10-04 with `npm run capture-fixtures` against World Machine build 4067 (Dragontail Peak, x64-AVX2, Linux AppImage).
Transcripts: `test/fixtures/wm-4067/raw/`. Each file holds `>>> <command>` ... `<<<` sections. Lines matching
`/licen[cs]e/i` were dropped by the capture script, and home and temp paths are scrubbed (`<HOME>`, `<WORK>`, `<APPDIR>`).
Spec references are to `docs/superpowers/specs/2026-10-04-worldmachine-mcp-design.md` section 2.

## Capture mechanics (spec facts 14 and 15)

The first capture attempts failed because World Machine processes only the first new line per stdin read (fact 14). The script
now writes `"\n"` every 100 ms until the last sentinel is answered; empty lines produce no output (fact 15). Consequence for
Plan 2: the command queue must write one command per write, or nudge with empty lines, and must expect no output for the nudge.
Sentinel framing (a never-valid command answered with `Error: Unknown command: '...'`) worked in every batch, so it is a usable
end-of-response marker in the captures.

## V1. Merged stream order

Outcome: PASS. In `v1-result-before-next-error.txt`, `>>> system info` returns the full System Info block with no `Error:` line, and
`>>> capture_bogus_command` returns `Error: Unknown command: 'capture_bogus_command'. Type 'help' for a list of commands.`
Plan 2: with stdout and stderr merged, one command's result precedes the next command's error line, as long as commands are sent
one per read (facts 14 and 15).

## V2. Commands after a failing command

Outcome: PASS. `v2-batch-after-error.txt`: `>>> capture_bogus_command` gives the `Error: Unknown command` line, then `>>> system info`
still returns `World Machine System Info:`.
Plan 2: a failing command does not abort later queued commands.

## V3. `project new default`

Outcome: `project new default force` printed `Created new default project.` (and a log line `[Info       ] Closing current project`)
without a prompt. The following `device list` shows `Devices (17 total):`, the same 17 devices as the startup project in
`device-list-sample.txt`, and `scene show` shows `Scene 'Main Extents' (index 0 of 1):`. Whether this is the sample project or a
freshly built default template is unclear from the transcripts (identical device list in both).
Plan 2: `project new default force` does not prompt. `project new blank force` (used in v4 and v6) prints `Created new blank project.`
and the first `device add` afterwards gets `#1`, with `device list` showing `Devices (1 total):` (`v4-quoting.txt`).
Evidence: `v3-project-new-default.txt`, `device-list-sample.txt`.

## V4. Quoting names with spaces

Outcome, from `v4-quoting.txt`:
- `device rename Gradient Grad A` printed `Renamed 'Gradient' to 'Grad A'`: an unquoted trailing name with spaces is accepted.
- `device rename Gradient "Grad B"` printed `Renamed 'Gradient' to 'Grad B'`, and `'Grad C'` likewise. The following `device list` shows
  `Grad B` and `Grad C` without quote characters, so both quote styles are stripped.
- `device rename #4 GradById` printed `Renamed '#4' to 'GradById'`: `#<id>` works as a device reference.
- `wire connect Grad A Combiner` failed with `Error: Error: Source device not found: 'Grad'`: an unquoted name with a space is not
  accepted in a non-final argument.
- `wire connect "Grad B" Combiner` resolved the quoted source (the error was `Input 'Combiner' is already connected. Disconnect first.`,
  about the input, not the name). Inference: the source name is checked before the input, because the unquoted case errored on the source
  although the input was occupied too. `wire connect #4 #5` was also resolved by id (same input-occupied error type).
- Single quotes were not tested in a non-final argument.
- `wire connect Gradient Combiner` succeeded: `Connected 'Gradient' [1] -> 'Combiner' [1]`.
- Not tested: quoting of a device name inside `device.param` references (see V6).
Plan 2: the command builder must always quote names containing spaces with double quotes, or use `#<id>`; prefer `#<id>`.
Errors carry a doubled prefix, `Error: Error: ...`.

## V5. Read formats

Outcome, from `v5-read-formats.txt` (sample project):
- `device select Erosion`: `Selected: Erosion`.
- `device info`: block `Selected device:` with indented `Name:`, `Type:`, `Enabled:`, `Bypass:` lines, then a blank line.
- `param list Erosion`: header `Parameters for 'Erosion' (Erosion):`, then rows `  <name>  <type>  <value>` (two-space indent, column
  padded). Types seen: `float`, `other` (group rows, empty value), `enum`, `bool`; values may carry units (`400 m`, `74.0°`) and
  a value may be empty. Types `filename` and `action` appear in the Height Output listing; `int` appears in `v6-param-values.txt`.
- `wire list Erosion`: `Connections for 'Erosion':`, `  Inputs:` rows `    [n] <port name> <- '<device>' [m]` or `<- (none)`,
  `  Outputs:` rows `    [n] <port> -> '<device>' [m]`; a continuation row for a second target omits the port name (`                     -> 'Vegetation Layer' [2]`).
  Port names are space-padded to a column in some rows (`Water input  <-`, `Flow Mask    ->`), but `Primary Input <-` has a single space, so split on the arrows, not on fixed columns.
  The same device appears twice in the `Flow Mask` output in the sample, so duplicate targets are possible.
- `scene show`: `Scene 'Main Extents' (index 0 of 1):` followed by `Origin (center)`, `Size`, `Lower-left`, `Upper-right`, `Resolution`, `Locked` lines.
- `scene list`: `Scenes (1 total):`, `  [0] 'Main Extents' - 12.0x12.0 km, res 2049 *`, blank, `* = current scene`.
- `group list`: `Groups (5 total):`, rows `  [#0] Create your Terrain      (6 devices)`.
- `device list`: `Devices (N total):`, rows `  #<id>  <name padded>  (<type>)` where the `(<type>)` suffix appears only when the name differs from the type
  (inferred from the observed rows: `Bitmap Output`, `Macro`, `Gradient`); an empty project prints `No devices in the current project.`
- `param get`: `<device>.<param> = <value>` (see `v6-param-values.txt`).
- `device list Height` returned only `#1 Height Output` while the header still said `Devices (17 total):`, so a trailing argument filters the rows; case sensitivity is unclear.
Plan 2: parse by these layouts; keep unit suffixes in values as raw text.

## V6. `param set` value syntax

Outcome, from `v6-param-values.txt`:
- `int` (`Gradient.Direction`): `param set Gradient.Direction 0.5` gave `Error: Error: Invalid integer value: 0.5`; `... 2` gave `Set Gradient.Direction = 2` and `param get` returned `Gradient.Direction = 2`.
- `bool`, `filename`, and `enum` could not be exercised: every `param set Height Output.<param> ...` returned
  `Error: Error: No device selected. Use 'param set <device>.<param> <value>' or select a device first.` The device name contains a space and
  was not quoted, which is the likely cause of the misparse (not confirmed). `param get Height Output.exportAlways` did work unquoted (`Height Output.exportAlways = false`), so
  `param get` and `param set` differ in how they split the reference. Unclear whether quoting or `device select` first fixes `set`.
- `float` was not exercised: the script picks the first numeric parameter, which was the `int` `Direction` (`Width` is `float`, listed as `8 km`).
Plan 2 consequence: another capture is needed for `bool`, `enum`, `filename`, and `float` values, with `device select` first or a quoted reference.
A V6 re-capture (with `device select`, quoted, or `#id` references, and an explicit `float` parameter) is planned as the first task of Plan 2.

### V6b re-capture (2026-10-05, `v6b-param-set.txt`, `help.txt`)

- Device references: `param set "Height Output".exportAlways true`, `param set "Height Output.exportAlways" false`, `param set #2.exportAlways true`, and `device select Height Output` followed by `param set exportAlways false` all succeeded; each `param get` read back the new value.
- `float`: plain numbers are accepted; units and decimal commas are rejected (`Error: Error: Invalid float value: 1.5 km`, `... 1,5`). The value set is World Machine's internal value, not the displayed unit: `Gradient.Width` showed `8 km`, `param set #1.Width 0.5` then read back `4 km`, and `2` read back `16 km`.
- `int`: `3` accepted, `3.0` rejected (`Invalid integer value: 3.0`).
- `bool`: `true`, `false`, `1`, `0`, `yes`, `off` all accepted and read back as `true`/`false`.
- `enum`: a 0-based index is accepted (`0` read back `Clamp`, `1` read back `Mirrored Repeat`); `invalid-enum-value` is rejected (`Invalid enum value`). Setting by option name was not tested.
- `filename`: a path with spaces as the final argument is accepted, and surrounding double quotes are stripped.
- `param set` confirms with `Set <ref> = <input as typed>`; only `param get` (`<ref> = <value>`) shows the resulting value.
- `help` lists a top-level `echo <text>` command and short aliases (`set`, `get`, `select`, `connect`, ...). Per-group help texts are in `help.txt`.
New devices are named by type, so `File Output` was added as `Height Output`.

## V7. Project operations

Outcome, from `v7-project-ops.txt`:
- `project save <path>`: `Project saved to: <path>` (a path with spaces worked unquoted as the last argument).
- `project undo`: `Undo performed.`; `project redo`: `Redo performed.`
- `project open <path>`: `Opened: <path>`. With or without trailing `force`, and with a path containing spaces unquoted, it opened.
- `project open <missing path> force`: `Failed to open project.` (a plain line, not prefixed `Error:`). The following `device list` printed
  `No devices in the current project.`, so a failed open leaves an empty project.
- `project open` without `force` while the project had unsaved changes: unclear (the save immediately before cleared the dirty state, so no prompt was triggered).
Log lines (`[Info       ] ...`) appear after command results in these transcripts (for example `Open Project from file`, `Closing current project`), inside the same section.
Plan 2: failure of `project open` is detected by the text `Failed to open project.`, not by an `Error:` line.

## V8. Licence checkout failure

Not observed. The capture script cannot provoke it.
