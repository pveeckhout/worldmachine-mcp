# worldmachine-mcp

An [MCP](https://modelcontextprotocol.io) server that lets AI assistants inspect and edit [World Machine](https://www.world-machine.com) terrain projects through your own local World Machine installation.

> **Status: early development.** All thirty tools listed below work against World Machine build 4067 on Linux: the eighteen of v1, the five build and export tools of v2a, and the seven snapshot, layout, and group tools of v2b. The design is in [`docs/superpowers/specs/2026-10-04-worldmachine-mcp-design.md`](docs/superpowers/specs/2026-10-04-worldmachine-mcp-design.md), [`docs/superpowers/specs/2026-10-05-worldmachine-mcp-v2a-design.md`](docs/superpowers/specs/2026-10-05-worldmachine-mcp-v2a-design.md), and [`docs/superpowers/specs/2026-10-06-worldmachine-mcp-v2b-design.md`](docs/superpowers/specs/2026-10-06-worldmachine-mcp-v2b-design.md).

## How it works

The server runs on your machine, launched by your MCP client over stdio. When a tool needs World Machine, the server starts it with `--cli` and sends commands through its interactive console. World Machine stays the only program that reads and writes `.tmd` files.

```text
MCP client (Claude Code, Codex, Claude Desktop, Cursor, ...)
  -> stdio
worldmachine-mcp
  -> stdin / stdout pipes
World Machine --cli (your installation, your licence)
```

- World Machine starts on the first tool call that needs it, not when your MCP client starts.
- The World Machine window is visible while the server uses it, so you can watch the changes happen.
- After 15 minutes without tool calls, the server quits World Machine to free your licence seat (unless there are unsaved changes).

## Requirements

- World Machine with command-line console support. Developed against build 4067 (Dragontail Peak).
- A World Machine licence. Nothing from World Machine is bundled. World Machine must be activated on the machine first (start it once normally). When its licence checkout fails at startup, the server waits until the 45 s startup limit for World Machine to repair its activation (it often does, within seconds) or for you to activate it in its dialog; after that, or when you quit the dialog, the tools fail with `START_FAILED` and the message "World Machine has no valid licence on this machine. Start World Machine once outside the MCP and activate it, then retry."
- Node.js 22.12 or later.
- Linux. Windows and macOS are planned but not yet supported.

## Installation (planned)

Claude Code:

```sh
claude mcp add worldmachine \
  --env WORLD_MACHINE_BIN=/path/to/WorldMachine-current-x64.AppImage \
  --env WORLD_MACHINE_ALLOWED_ROOTS=/path/to/your/terrain/projects \
  --env DISPLAY=$DISPLAY \
  --env WAYLAND_DISPLAY=$WAYLAND_DISPLAY \
  --env XAUTHORITY=$XAUTHORITY \
  --env XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR \
  -- npx -y @hoakt/worldmachine-mcp
```

Run `printenv DISPLAY WAYLAND_DISPLAY XAUTHORITY XDG_RUNTIME_DIR` first and drop the `--env` line for any variable your session does not set (an X11 session usually has no `WAYLAND_DISPLAY`; a Wayland session without Xwayland may have no `XAUTHORITY`). An unset variable expands to an empty value, which is passed to World Machine as an empty string.

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.worldmachine]
command = "npx"
args = ["-y", "@hoakt/worldmachine-mcp"]

[mcp_servers.worldmachine.env]
WORLD_MACHINE_BIN = "/path/to/WorldMachine-current-x64.AppImage"
WORLD_MACHINE_ALLOWED_ROOTS = "/path/to/your/terrain/projects"
DISPLAY = ":0"
WAYLAND_DISPLAY = "wayland-0"
XAUTHORITY = "/run/user/1000/.mutter-Xwaylandauth.XXXXXX"
XDG_RUNTIME_DIR = "/run/user/1000"
```

Any other MCP client that accepts a JSON configuration:

```json
{
  "mcpServers": {
    "worldmachine": {
      "command": "npx",
      "args": ["-y", "@hoakt/worldmachine-mcp"],
      "env": {
        "WORLD_MACHINE_BIN": "/path/to/WorldMachine-current-x64.AppImage",
        "WORLD_MACHINE_ALLOWED_ROOTS": "/path/to/your/terrain/projects",
        "DISPLAY": ":0",
        "WAYLAND_DISPLAY": "wayland-0",
        "XAUTHORITY": "/run/user/1000/.mutter-Xwaylandauth.XXXXXX",
        "XDG_RUNTIME_DIR": "/run/user/1000"
      }
    }
  }
}
```

**Linux note.** World Machine opens its window even in console mode. MCP clients that start servers with a minimal environment must pass the display variables (`DISPLAY`, `WAYLAND_DISPLAY`, `XAUTHORITY`, `XDG_RUNTIME_DIR`), as shown above. Use the values from your own session.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `WORLD_MACHINE_BIN` | required | path to the World Machine executable |
| `WORLD_MACHINE_ALLOWED_ROOTS` | working directory | directories the server may open and save projects in, separated by `:` |
| `WORLD_MACHINE_DEFAULT_PROJECT` | none | project to open when World Machine starts; otherwise a new project is created. After an idle quit (or a crash with no unsaved changes) the next start reopens the last opened project instead, unless the call is open_project or create_project |
| `WORLD_MACHINE_LOG_LEVEL` | `info` | verbosity of World Machine log output on the server's stderr |
| `WORLD_MACHINE_COMMAND_TIMEOUT_MS` | `15000` | time limit per command batch |
| `WORLD_MACHINE_IDLE_TIMEOUT_MS` | `900000` | idle time before World Machine is closed, `0` disables. The next start after an idle quit reopens the last opened project, unless the call is open_project or create_project |
| `DISPLAY`, `WAYLAND_DISPLAY`, `XAUTHORITY`, `XDG_RUNTIME_DIR` | none | passed through to World Machine; required on Linux desktops when the client does not forward them |

If the working directory is `/` or your home directory and `WORLD_MACHINE_ALLOWED_ROOTS` is not set, tools that take a path refuse to run.

## Tools

| Read | Change |
|---|---|
| `get_world_machine_status` | `open_project`, `create_project`, `save_project` |
| `list_devices` | `add_device`, `rename_device`, `delete_device`, `set_device_enabled`, `set_device_bypassed` |
| `get_device` | `update_device_parameters` |
| `get_scene` | `connect_devices`, `disconnect_devices` |
| `inspect_project` | `configure_scene`, `undo`, `redo` |
| `get_build_status` | `build_project`, `stop_build` |
| `list_exports` | `export_outputs` |
| `list_snapshots` | `create_snapshot`, `restore_snapshot`, `delete_snapshot` |
| `list_groups` | `set_group_enabled`, `organize_devices` |
| `plan_graph` | `apply_graph` |

Editing notes:

- Devices are referenced by name or by their stable id `#<n>`. Names match regardless of case; a name that several devices share is refused, so use the id.
- `add_device` and `rename_device` refuse names that `list_devices` could not show unambiguously: leading or trailing spaces, a trailing `[disabled]` or `[bypassed]`, trailing parenthesised text after two or more spaces, `#<n>`, or more than 23 characters.
- `get_device` lists an enum parameter's options in index order (`options`), from a catalog captured once from World Machine build 4067 and shipped with the server; the console has no command that lists them. The catalog describes devices as `device add` creates them. A row has no `options`, and the device's `enumOptionsNote` says why, when World Machine is another build, the catalog has no entry for the device type or parameter, the device's parameter names differ from a new device's (an older device version, as in the default project's Flow Restructure), or the row's current value is not one of the catalog's options. A device of another version with the same parameter names still shows the catalog's options. Labels are as `param get` prints them, cut at 31 characters (`Hue / Saturation / Brightness (`).
- Port types: `get_device` shows each output's port type (`type`) and the types each input accepts (`accepts`), with `portTypes: 'catalogued'`, from a catalog captured once from World Machine build 4067 (every output of every type wired to every input of every type, a type's own inputs through a second device of it) and shipped with the server; the console reports no port type. A device that `plan_graph` would add is typed only when its `type` is one of the words the capture added it with (`File Output` and `Height Output` both work; `VDM Features`, a listed name that is no add word, does not); otherwise its wires are unchecked. When World Machine is another build, or the device's ports differ from those of a new device of its type (an older device version), `portTypes` is `unknown` and the port fields are absent. The catalog was captured on unconnected devices. For one adaptive chain a live probe showed that feeding changes nothing: a Chooser or Combiner fed by Layers is still refused by Material Output, as the catalog says (2026-10-14). Other fed combinations of devices whose type may follow their inputs (Chooser, Combiner, Layers, Router) are not captured, so a check there rests on the unconnected device; `connect_devices`, which checks nothing, can still try such a wire. A device of another version with the same port names is typed by the catalog. `plan_graph` reports a wire between typed ports that the input does not accept as a conflict, so `apply_graph` refuses the spec before changing anything, and lists a wire with an untyped end in `uncheckedWires`. `connect_devices` checks no types; when World Machine refuses a wire with `incompatible types?` and both ends are typed, its error names the output's type and the types the input accepts.
- `update_device_parameters` takes World Machine's internal values, not the displayed units: a width of `0.5` can read back as `4 km`. A float whose value shows `m` or `km` also takes a length such as `"500 m"` or `"2.5km"`: the call reads the parameter's scale by setting it to `1`, reading it, and undoing that set, then sends the length divided by the scale (at most 12 significant digits), and an item whose scale was read reports `given` and `scale` beside `requested` (an item rejected at the probe has neither). The probe marks the project unsaved even after its undo, and when no item is set after a length item's probe, do not use `redo` before another edit, since it would set that parameter to 1. The read-back can differ from the length given because World Machine rounds what it displays (`656.25 m` reads `656.2 m`). The scale itself is read from World Machine's display, rounded to four significant digits, so a length can be off by up to 0.05%. If that undo cannot be confirmed, the call fails before anything else is set and the parameter may be left at `1`. One `undo` still reverts one parameter per call, and `plan_graph` and `apply_graph` specs take no lengths. It takes plain decimal numbers, enum options as the 0-based index of their label in `get_device`'s `options` (a row without `options` has its reason in `enumOptionsNote`; finding an index by setting values makes unsaved changes), and booleans as `true` or `false` (or `1`, `0`, `yes`, `off`); World Machine itself would also take exponent forms, enum labels, and other boolean words, which the tool refuses so each value is checked before it is sent. Parameter names are case-sensitive. `action`, `other`, and `filename` parameters and `exportAlways` cannot be set; `filename` because World Machine would write build output outside the allowed roots, `exportAlways` because it makes a full build write files. Each item reports the value World Machine reads back.
- `set_device_enabled` and `disconnect_devices` read the result back, because World Machine prints the same confirmation whether or not anything changed. `connect_devices` leaves an existing wire alone, and refuses a wire from a device into its own input before sending it, since World Machine refuses one with its `incompatible types?` answer whatever the types. World Machine's connection list names the devices at both ends of a wire, not their ids, so when the destination's input shows the given source's name and several devices share that name, `connect_devices` and `disconnect_devices` read each of those devices' connections and take the one whose output lists that input. They refuse, naming the ids, only when none or more than one does, for example two Combiners that each feed input 1 of another Combiner. An input that shows another name is not wired from the source: `connect_devices` sends the connect (World Machine refuses an occupied input) and `disconnect_devices` returns `removed: false`. World Machine also refuses a wire that would close a loop (two and three devices captured); `connect_devices` then fails with `WM_COMMAND_FAILED`, and `apply_graph`, for a wire in `possibleLoops` that does close a loop, rolls back and returns the step in `failedStep`, in both cases with World Machine's sentence (`These ports cannot be connected as the result will create a cycle in the graph!`) in `worldMachineMessage`. `plan_graph` reports a wire that would close a loop as a conflict, so `apply_graph` refuses the spec before its snapshot; when the loop runs through devices whose wires cannot be told apart (two devices that share a name), it lists the wire in `possibleLoops` instead, a warning that `apply_graph` repeats, and World Machine's refusal then rolls the apply back if that wire does close a loop.
- `set_device_bypassed` sets bypass rather than toggling it: World Machine's `device bypass` toggles, so the device is read first and nothing is sent when it is already in the requested state. `list_devices` omits bypass for a disabled device; `get_device` reports it.
- No edit is rolled back automatically; use `undo`. It reverts one step per call: one parameter, one scene setting, or one device edit. `add_device` with a name is two steps (add, then rename), so the first undo reverts the rename and the second removes the device. Undoing a delete restores the device with its wires.

Builds and exports:

- `build_project` takes a mode. `preview` is World Machine's quick preview; `full` builds every device at the scene resolution and writes no files; `tiled` runs the tiled build set up in the World Machine window and writes every output as tiles (`<name>_x0_y0` and so on) next to its export path; `group` builds the devices of one device group, named by `group` (a name in any case, or `#<n>` from `list_groups`). A group build does not make the outputs exportable: `export_outputs` still needs a full build. A group without devices is refused.
- `build_project` waits up to `wait_seconds` (default 60, at most 600) for the build to end. If the wait ends first, the result says `running` and the build continues: check `get_build_status`, or stop it with `stop_build`; once the build ends, `get_build_status` also reports whether every output was built. Cancelling the call does not stop the build.
- While a full, tiled, or group build runs, every other change tool is refused; the read tools keep working. World Machine starts previews on its own after edits, so a preview blocks nothing.
- A build started in the World Machine window counts too, provided World Machine reports it on its console (assumed, not yet captured). `get_build_status` shows it with `startedBy: 'world-machine'` and mode `unknown` until it shows as a full build. If `stop_build` sees no end within 10 s, the server stops tracking such a build, so the change tools work again.
- World Machine ends a build that built nothing the same way as one that built. After a `full` build that finished within the wait, `build_project` reads `debug devicetiming` for every device (a device is built when it has a result at the scene resolution) and reports `outputsBuilt`, `notBuilt` (the outputs without a result), `stoppedAt` (the devices where building stopped on the way to an output that was not built: no result, while every wired input has one), and a `hint` when an output was not built: a device added from the console can be an older version that does not build, and only the Project Version dialog in the World Machine window updates it. If the check itself fails, the result is still `finished` and `outputsCheckError` says why. `preview`, `tiled`, and `group` builds, and a `running` result, are not checked, so there `finished` means only that the build ended. A build ended by `stop_build` is reported as finished too; a `full` one is checked and its outputs report not built.
- If an output has `exportAlways` set (in the World Machine window), or the server cannot confirm that it is off, a full or group build may write its file, so `build_project` with `full` or `group` then checks every output path as an export does, and refuses for a project never saved or a path outside the allowed roots.
- `export_outputs` runs World Machine's `export all` after a full build; it is refused when the outputs are not built. A Material Output writes four files (`_diffuse`, `_disp`, `_mask`, and `_roughness`) for its one listed path.
- Exports and tiled builds overwrite files with the same names without asking. They are refused for a project that was never saved (World Machine would write into `~/Documents/WorldMachine`), and when any output would be written outside the allowed roots or into a folder that does not exist. `list_exports` shows each output's path and whether it is allowed.
- Output templates, device names, and expanded output paths with a `.` or `..` segment are refused, including `./<name>.png`.

Snapshots, layout, and groups:

- A snapshot holds the device graph. Use one as a checkpoint before a risky series of edits, or keep several as named variants of a project and switch between them with `restore_snapshot`.
- Snapshots are stored in the project file and are kept only after `save_project`; closing the project without saving loses them, so the session counts as unsaved after `create_snapshot`, `restore_snapshot`, or `delete_snapshot`.
- Snapshot names are 1 to 64 characters, without leading or trailing spaces, quotes, backslashes, or the form `#<n>`. A name another snapshot already has is refused, because World Machine would accept it and every later reference by that name would be ambiguous.
- `restore_snapshot` reverts the graph and keeps the snapshots made after the restored one; one `undo` reverts the restore. `delete_snapshot` removes one snapshot, and the ones after it move down one index.
- Snapshots and groups are referenced by name or by `#<index>`. Snapshot names compare exactly, group names regardless of case; a name several of them share is refused, so use the index.
- `set_group_enabled` sets every member device's own enabled state: enabling a group also enables members that were disabled one by one. One `undo` reverts the whole group. A group without devices changes nothing. `list_groups` shows each group's device count, not its members.
- `organize_devices` lays the graph out by processing order in the World Machine window; the console cannot show the layout, so the result cannot be confirmed, and `undo` is expected to revert it, but the console cannot confirm that either.

## Declarative graphs: plan_graph and apply_graph

`plan_graph` and `apply_graph` let the AI assistant describe a graph instead of editing it one command at a time. One spec serves both uses: build a new graph in an empty project, or bring the devices the spec names in an existing project to the state it gives.

```json
{
  "version": 1,
  "devices": [
    { "name": "Shape", "type": "Layout Generator" },
    {
      "name": "Base",
      "type": "Advanced Perlin",
      "enabled": true,
      "parameters": { "octaves": 8, "scale": 0.4 },
      "inputs": { "1": "Shape.1", "2": null }
    }
  ],
  "remove": ["Old Noise"]
}
```

- A device the spec names is managed; devices it does not name are never changed, except that their wires to removed devices go with them. Deleting needs `remove`. Renaming is not part of the spec, because the name is the identity of an entry without `id`: use `rename_device`.
- An entry with `id` manages that existing device whatever its name, for example `{ "name": "hills mix", "id": 536, "type": "Combiner", "inputs": { "1": "Base", "2": "Hills" } }`. Its `name` is then a label that inputs refer to; it is never sent to World Machine, and the device is never renamed. An entry with `id` never adds a device: an id no device has is a conflict. Take the id from `list_devices`, `add_device`, or a previous apply's diff.
- An added device whose spec name differs from its default name is renamed. World Machine ignores a rename of a Combiner (it confirms it and keeps `Combiner`), so a Combiner entry without `id` that matches no device must be named exactly `Combiner`. Any other such name is a conflict whose reason says to add the device with `add_device` and give its id in the spec; for an alias type such as `Average` (which adds a Combiner), the reason also says to give the type as `Combiner`. An entry named `Combiner` matches an existing device by name as before, and is a shared-name conflict when two devices have that name (use `id`). That is also how a spec manages several Combiners. No other device type behaves this way. Give `type` as World Machine's exact type name: `device add` also accepts aliases such as `Average` (a Combiner) or `Water` (a Coast Erosion) and adds whatever type they pick, so `apply_graph` checks the type of each device it adds and rolls back on a mismatch.
- `bypassed` (true or false) sets a device's bypass state, like `enabled`; it is set, not toggled, and compared exactly, so a second plan of the same spec plans nothing for it. The diff shows it as `bypassed` on added and changed devices.
- Fields a device entry leaves out are left as they are. An `inputs` value of `null` means no wire; an input port the entry does not list is left alone.
- Two steps: call `plan_graph`, show the plan to the user, then call `apply_graph` with the same spec and the `plan_id` from the plan (`planId` in the plan result). `apply_graph` plans again and refuses when the project changed since, or when the plan has conflicts. `plan_graph` sends only read commands. A plan with conflicts is still returned so they can be shown.
- Conflicts include a name that several devices share (a spec source too; use `#<id>` or a label), an `id` no device has, a device of another type than the spec's, an unknown port or parameter, a wire from a device into its own input or one that would close a loop (World Machine refuses both), and, for an existing device, a value its parameter type refuses. A current wire whose source name several devices share is resolved through their output targets, as `disconnect_devices` does; one that cannot be resolved is a conflict naming the candidate ids. `plan_graph` lists in `unidentifiableWires` each wire into a managed device that the apply would leave unidentifiable: two same-named devices (for example two Combiners) that each feed the same input port number of two devices that also share a name, such as `'a mix' input 1 from 'Combiner' output 1: #536, #537 each list 'Combiner' input 1`. It is a warning, not a conflict: `apply_graph` still applies the spec and returns the same list, and after that `disconnect_devices` refuses that wire and a re-plan reports the input as a conflict when the spec lists that input, and lists it in `unidentifiableWires` again otherwise, until one of the wires is changed in the World Machine window or by undo. A wire the plan already reports as a conflict is not listed again. For a device the plan adds, a wrong port or value fails during the apply and is rolled back.
- Floats and enums are always planned with `comparable: false`, because World Machine shows display units and labels but takes internal values and indexes, so the current value cannot be compared. Spec values for an enum are indexes, the position of a label in `get_device`'s `options`; labels are refused. Applying the same spec twice therefore plans only these steps the second time.
- Steps run under the snapshot `apply_graph <12 hex>`. A failed step restores it and returns `APPLY_FAILED` with `rolledBack`, the failed step, and the completed steps. After a crash or timeout nothing is restored and the snapshot is gone, since snapshots live in memory until `save_project`. A successful apply deletes the snapshot unless `keep_snapshot` is true, and returns a diff of the devices it touched. Moving an input between two devices that share a name does not show in the diff's `inputs`, because the diff names sources by listed name; the plan steps show the ids.
- After a failed apply the snapshot is kept: restored to (`rolledBack: true`), or left for you when the restore could not be confirmed. Retrying the same spec gives the same `planId` and is refused while that snapshot exists; inspect or restore it, remove it with `delete_snapshot`, then retry.
- A running full, tiled, or group build refuses an apply. `undo` does not revert an apply in one step; the snapshot does.

## What the MCP can and cannot set up

The server only does what World Machine's console can do, and it never edits the binary `.tmd` file itself. Some project setup therefore has to be done in the World Machine window, and saved into the project, before the AI assistant works on it.

The MCP can set up:

- the device graph: add, rename, enable or disable, and delete devices, and connect or disconnect them;
- device parameters of type `float`, `int`, `bool`, and `enum`, including output-device switches such as File Output's `tiled`;
- the current scene (render extent): its name, centre, size in km, and render resolution;
- snapshots of the device graph, and the layout of the graph by processing order;
- device groups that already exist: enabling or disabling all their devices, and building one group.

Set these up in World Machine first, because its console (build 4067) has no command for them:

- World settings: sea level (water level), height scale and units, and the world's overall extents;
- the tiled-build layout: tile count, tile resolution, and overlap or blending (a tiled build uses whatever is configured there);
- output file names and folders of File Output devices (`filename` parameters are refused, see Safety);
- additional scenes: the console can select and change an existing scene but cannot create one;
- device groups, macros, and blueprints: the console can list, enable, disable, and build groups but cannot create them, rename them, or assign devices to them.

The console also offers scene selection and locking. The MCP does not expose these yet.

## Safety

- Projects can only be opened or saved inside the allowed roots. Symlinks are resolved before the check.
- Saving never overwrites an existing file unless the tool call says so explicitly.
- Exports and tiled builds write only into existing folders inside the allowed roots, and only for a saved project; they overwrite files of the same name.
- Quitting always closes the project first, so World Machine shuts down normally and returns the licence seat; unsaved changes are discarded when the server stops.
- Opening or creating a project refuses to discard unsaved changes unless the tool call says so explicitly.
- There is no tool for running arbitrary World Machine console commands.
- World Machine log output, including licence information, is never returned to the AI assistant.

## Troubleshooting

**"World Machine is showing its 'Recover crashed session' dialog."** World Machine found sessions that did not end cleanly and is asking which one to restore. Answer the dialog in the World Machine window (OK restores the chosen session, Cancel does not), then retry the tool call; the server keeps waiting for up to 10 minutes. After OK, the restored project stays open with unsaved changes, and `get_world_machine_status` reports `recovered: true`. Save it with `save_project` before the MCP client exits if you want to keep it: shutdown discards it, and World Machine removes its autosave when it exits cleanly.

Every crash or forced kill of World Machine queues one more crashed session, and World Machine shows the dialog at a start only when more than one is queued; a single queued session is restored silently, with its project open and unsaved. To clear the queue, start World Machine yourself (outside the MCP), answer the dialog, quit World Machine normally, and repeat until the dialog no longer appears. Whether Cancel leaves a session queued has not been checked.

**"I stopped a large build and World Machine did not quit."** After `stop_build` of a build at a high scene resolution (4097 was observed), World Machine can be unable to quit; this is a World Machine issue. The server ends it after its shutdown grace and logs a warning. The stopped project is restored at the next World Machine start, silently when it is the only queued session and with the 'Recover crashed session' dialog when several are queued. Save before stopping a large build if the project matters.

**"World Machine keeps asking to be activated again, or the tools fail with `START_FAILED` and 'no valid licence'."** On Linux, World Machine's licence is tied to the current MAC address of the first network interface, usually the Wi-Fi card. NetworkManager on Fedora and other distributions changes that address by default: each Wi-Fi network gets its own (`wifi.cloned-mac-address=stable-ssid`), and a random one is used while the Wi-Fi scans. After such a change, World Machine either re-activates by itself within seconds or shows its activation dialog. Activate once outside the MCP, or make NetworkManager keep the hardware address on Wi-Fi, at the cost of Wi-Fi privacy; see the [licence bug report](docs/research/2026-10-15-worldmachine-licence-mac-bug-report.md) for the evidence and the configuration.

## Documentation

- [Design spec](docs/superpowers/specs/2026-10-04-worldmachine-mcp-design.md)
- [v2a design: builds and exports](docs/superpowers/specs/2026-10-05-worldmachine-mcp-v2a-design.md)
- [v2b design: snapshots, device organize, and groups](docs/superpowers/specs/2026-10-06-worldmachine-mcp-v2b-design.md)
- [Feasibility findings](docs/research/2026-10-04-feasibility-findings.md)

## Licence

[MIT](LICENSE). World Machine is a trademark of its owner. This project is not affiliated with or endorsed by the makers of World Machine.
