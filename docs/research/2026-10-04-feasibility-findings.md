# World Machine 4067 MCP feasibility findings

## Conclusion

A local MCP server for World Machine 4067 is feasible and can be shared with Codex. The server should control World Machine through its supported interactive command line rather than parse or modify `.tmd` files directly.

The verified World Machine build exposes commands for project lifecycle, node creation and deletion, parameter inspection and mutation, wiring, scene configuration, builds, exports, snapshots, and undo and redo. This is sufficient for a structured MCP tool surface and for reproducibly generating a World Machine graph.

The recommended first distribution target is a local or repository-scoped Codex plugin. A public remote MCP is a poor fit for the initial version because World Machine, its licence, GPU access, and project files live on the user's machine.

## Environment verified

These findings were collected on 2026-10-04.

- Platform: Linux desktop
- World Machine executable: `WorldMachine-current-x64.AppImage` (local AppImage install)
- World Machine build: 4067, Dragontail Peak
- Available product tier during testing: Pro
- GPU compute backend detected by World Machine: Vulkan
- Test project: a local `.tmd` project file (`<project>.tmd`)

The executable supports these relevant arguments:

```text
--cli                  Enable an interactive terminal console on stdin
--minimal              Skip user macros, blueprints, and code library
--log                  Write log information to the console
projectfile            Open a TMD project or run one or more TMS scripts
```

World Machine reports that `.tms` automation scripts run without launching the GUI. Interactive `--cli` mode initializes the normal application and exposes a terminal prompt.

## Project file findings

The test file is a real World Machine `TMDFile2` binary. It is self-describing enough to inspect, but it is not a ZIP, XML document, or other safely editable text format.

The file still contains the default Hurricane Ridge example rather than a custom world:

- Project version: 2023.01
- Project name: Hurricane Ridge
- Scene: Main Extents
- Scene centre: 4 km, 4 km
- Scene size: 12 km by 12 km
- Resolution: 2049 by 2049
- Top-level devices: 17
- Top-level links: 29

The top-level devices reported by World Machine were:

```text
Height Output
Advanced Perlin
Curves
Erosion
Scene View
Vegetation Layer
Layers
Thermal Weathering
Ambient Occlusion
Material Output
Colormap only (Bitmap Output)
Tap
Flow Restructure
Texture Weightmap
Splatmap (Bitmap Output)
Easy Distortion (Macro)
Rock and Soil
```

Direct binary editing is not recommended. A load-and-save round trip through World Machine succeeded, but World Machine reserialized the file and changed its size and checksum while preserving the project version and name. This demonstrates why the application should remain the authority for reading and writing TMD files.

## Verified automation

A headless TMS script successfully performed this sequence:

```xml
<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<automation version="WMP2">
  <section name="Round-trip validation">
    <load file="/absolute/path/to/project.tmd"/>
    <save file="/absolute/path/to/project-roundtrip.tmd"/>
  </section>
</automation>
```

The application loaded the input, saved the output, returned its licence seat, and exited normally. TMS automation is suitable for non-interactive load, save, build, and export jobs. The interactive CLI is more suitable for MCP because it can inspect and modify the device graph.

## Verified interactive command surface

The CLI advertises these command groups:

```text
analytics
build
debug
device
export
group
param
project
scene
snapshot
system
update
wire
```

The following commands were directly observed:

### Projects

```text
project close [force]
project new [blank|default|force]
project open <path> [force]
project save [path]
project undo
project redo
```

### Devices

```text
device add <type>
device bypass <name>
device delete <name>
device disable <name>
device enable <name>
device info
device list [filter]
device organize
device rename <oldname> <newname>
device select <name>
```

### Parameters

```text
param get [device.]<param>
param list [device]
param set [device.]<param> <value>
```

### Wires

```text
wire connect <source>[.port] <dest>[.port]
wire disconnect <source>[.port] <dest>[.port]
wire list <device>
```

### Scenes

```text
scene list
scene lock [on|off]
scene name [name]
scene origin <x_km> <y_km>
scene resolution [value|up|down] [count]
scene select <index|name>
scene show
scene size [width_km height_km]
```

### Groups and system lifecycle

```text
group list [filter]
group build <name|#index>
group enable <name|#index>
group disable <name|#index>
system heal [apply]
system info
system purge
system quit [force]
```

The CLI also provides build, export, and snapshot groups that still need detailed command-level discovery.

## Device creation tests

A new blank project was created safely in memory. The following device types were accepted by `device add`:

```text
Gradient
Shapes
Combiner
Create Water
Select Height
Select Slope
Select Wetness
File Output
```

`File Output` created a device named `Height Output`. `Radial Gradient` was not recognized as a device type, while `Gradient` was accepted. The server must therefore discover or maintain the exact type names supported by each World Machine build instead of assuming documentation labels are valid CLI identifiers.

Parameter inspection also worked. Examples include:

- `Advanced Perlin`: Scale, Style, Persistence, Lacunarity, Octaves, Seed, Steepness, Elevation, height range, and guide controls.
- `Erosion`: Amount, feature scale, Hardness, Capacity, initial soil, soil scour, diffusion, wall angle, structure, masking, and compatibility.
- `Create Water`: drainage destination, headwater mode, channel head area, channel model, minimum depth, discharge, and flow speed.
- `File Output`: filename, format, automatic export, tiled output, and write action.

## Recommended MCP architecture

```text
Codex
  -> MCP over stdio
World Machine MCP server
  -> validated commands through a process supervisor
World Machine 4067 --cli
  -> TMD projects, builds, and exported maps
```

The MCP server should:

1. Launch one World Machine process per server or workspace.
2. Serialize all console commands through a single command queue.
3. Wait for the `wm>` prompt before completing a request.
4. Strip terminal control sequences and separate application logs from command results.
5. Parse command output into structured MCP results.
6. Track the currently open project and whether it has unsaved changes.
7. shut down World Machine cleanly with `system quit force` when the server exits.

Interactive CLI operation was verified through a pseudo-terminal. Plain stdin and stdout pipes have not yet been tested. The process adapter should start with a PTY implementation or test both modes before choosing one.

Do not use `--minimal` by default. It skips user macros and blueprints, which may be part of a project. It is useful for isolated tests and diagnostics.

## Proposed MCP tools

The first version should expose goal-oriented tools rather than an unrestricted `run_console_command` escape hatch.

| Tool | Purpose | State change |
| --- | --- | --- |
| `get_world_machine_status` | Report executable version, process state, current project, and active scene | No |
| `inspect_project` | Return project, scene, device, group, and connection summaries | No |
| `list_devices` | Return stable device IDs, names, types, and states | No |
| `get_device` | Return ports, parameters, connections, and status for one device | No |
| `get_scene` | Return scene origin, size, resolution, and lock state | No |
| `open_project` | Open a TMD after validating its path | Yes |
| `create_project` | Create a blank or default project | Yes |
| `add_device` | Add and optionally rename a supported device | Yes |
| `update_device_parameters` | Set one or more validated parameters | Yes |
| `connect_devices` | Connect typed source and destination ports | Yes |
| `disconnect_devices` | Remove a known connection | Yes |
| `configure_scene` | Set scene name, origin, dimensions, and resolution | Yes |
| `organize_devices` | Ask World Machine to lay out the graph | Yes |
| `save_project` | Save to an explicit path, preferably a new file by default | Yes |
| `build_preview` | Start a bounded preview build and report progress | Build |
| `build_project` | Run a full build with timeout and cancellation support | Build |
| `export_outputs` | Export configured output devices | External write |
| `apply_graph` | Reconcile a declarative graph specification into a project | Yes |

`apply_graph` is the high-value end state. It should accept stable logical names, exact device types, parameters, and port connections. It should produce a change plan before applying mutations and return a graph diff afterwards.

## Safety requirements

- Restrict project and export paths to configured workspace roots.
- Resolve paths to absolute canonical paths before executing commands.
- Never pass model-supplied text to a shell.
- Construct CLI commands from validated tokens and apply correct World Machine quoting.
- Do not expose arbitrary console execution in the normal tool surface.
- Keep read tools separate from mutation, build, export, and destructive tools.
- Save to a new file by default; overwriting an existing TMD should be explicit.
- Use World Machine snapshots or a filesystem backup before broad graph reconciliation.
- Include timeouts and cancellation for previews, builds, and exports.
- Redact licence data and unrelated application logs from MCP results.
- Return the exact command failure and current project state after errors.
- On uncertain save outcomes, inspect the target through World Machine before retrying.

## Codex packaging and distribution

The recommended repository layout is:

```text
worldmachine-mcp/
  plugin.json
  mcp.json
  server/
  skills/
    world-machine/
      SKILL.md
  tests/
```

Configuration should use environment variables rather than machine-specific paths:

```text
WORLD_MACHINE_BIN
WORLD_MACHINE_ALLOWED_ROOTS
WORLD_MACHINE_DEFAULT_PROJECT
WORLD_MACHINE_LOG_LEVEL
```

The plugin can be shared through a repository or Git-backed Codex marketplace. Users still need a compatible local World Machine installation and licence; neither should be bundled with the plugin.

OpenAI's current plugin documentation supports packaging MCP configuration and skills together, with local and repository marketplaces for private distribution. Public directory publication normally expects a remotely reachable HTTPS MCP endpoint, which does not naturally control a user's local World Machine installation. The local stdio plugin should therefore be the initial supported distribution model.

References:

- [Package your plugin](https://developers.openai.com/plugins/build/plugins)
- [Build an MCP server](https://developers.openai.com/plugins/build/mcp-server)
- [Define MCP tools](https://developers.openai.com/plugins/plan/tools)
- [World Machine Professional automation](https://help.world-machine.com/topic/world-machine-professional-edition-addendum/)
- [World Machine 4067 release notes](https://help.world-machine.com/topic/build-4067-dragontail-peak/)

## Known gaps and next investigations

1. Enumerate exact CLI syntax for the build, export, snapshot, and debug groups.
2. Determine whether the interactive console works reliably over ordinary pipes or requires a PTY.
3. Discover all valid device type identifiers programmatically, if the CLI exposes them.
4. Test enum, boolean, distance, angle, filename, and action parameter mutation syntax.
5. Confirm device naming and selection behaviour when duplicate default names exist.
6. Confirm port references by numeric index and display name, including spaces and duplicate labels.
7. Determine whether Shapes geometry can be created through exposed parameters or remains a GUI-only editing surface.
8. Test macros and blueprints with and without `--minimal`.
9. Test build progress, cancellation, output paths, and error recovery.
10. Verify clean operation when no GPU backend is available.
11. Decide the minimum supported World Machine build and implement a capability probe rather than relying only on a version number.

## Suggested implementation sequence

### Phase 1: Process adapter and read-only MCP

- Launch and stop World Machine.
- Parse prompts and remove terminal control sequences.
- Implement status, project inspection, device listing, parameter listing, connection listing, and scene inspection.
- Add transcript-based parser tests using captured CLI output.

### Phase 2: Controlled graph edits

- Add, rename, enable, disable, and delete devices.
- Set validated parameters.
- Connect and disconnect ports.
- Implement save-as, snapshots, undo, and rollback.

### Phase 3: Builds and exports

- Implement preview and full builds.
- Stream progress without blocking MCP indefinitely.
- Add cancellation, timeout, and export validation.
- Return exported files as paths or MCP resources.

### Phase 4: Declarative terrain graphs

- Define a versioned graph specification.
- Implement dry-run graph diffs and idempotent reconciliation.
- Add reusable graph templates and a skill describing terrain-generation workflows.
- Validate the workflow end to end by generating a world graph from a written brief and exporting elevation, drainage, wetness, slope, and resource-supporting masks.
