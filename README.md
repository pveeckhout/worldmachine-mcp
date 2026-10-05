# worldmachine-mcp

An [MCP](https://modelcontextprotocol.io) server that lets AI assistants inspect and edit [World Machine](https://www.world-machine.com) terrain projects through your own local World Machine installation.

> **Status: early development.** All eighteen v1 tools listed below work against World Machine build 4067 on Linux. The design is in [`docs/superpowers/specs/2026-10-04-worldmachine-mcp-design.md`](docs/superpowers/specs/2026-10-04-worldmachine-mcp-design.md).

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
- A World Machine licence. Nothing from World Machine is bundled.
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

## Tools (v1)

| Read | Change |
|---|---|
| `get_world_machine_status` | `open_project`, `create_project`, `save_project` |
| `list_devices` | `add_device`, `rename_device`, `delete_device`, `set_device_enabled` |
| `get_device` | `update_device_parameters` |
| `get_scene` | `connect_devices`, `disconnect_devices` |
| `inspect_project` | `configure_scene`, `undo`, `redo` |

Editing notes:

- Devices are referenced by name or by their stable id `#<n>`. Names match regardless of case; a name that several devices share is refused, so use the id.
- `add_device` and `rename_device` refuse names that `list_devices` could not show unambiguously: leading or trailing spaces, a trailing `[disabled]` or `[bypassed]`, trailing parenthesised text after two or more spaces, `#<n>`, or more than 23 characters.
- `update_device_parameters` takes World Machine's internal values, not the displayed units: a width of `0.5` can read back as `4 km`. It takes plain decimal numbers, enum options as their 0-based index, and booleans as `true` or `false` (or `1`, `0`, `yes`, `off`); World Machine itself would also take exponent forms, enum labels, and other boolean words, which the tool refuses so each value is checked before it is sent. Parameter names are case-sensitive. `action`, `other`, and `filename` parameters cannot be set; `filename` because World Machine would write build output outside the allowed roots. Each item reports the value World Machine reads back.
- `set_device_enabled` and `disconnect_devices` read the result back, because World Machine prints the same confirmation whether or not anything changed.
- Bypass is reported but cannot be set.
- No edit is rolled back automatically; use `undo`. It reverts one step per call: one parameter, one scene setting, or one device edit. `add_device` with a name is two steps (add, then rename), so undo likely reverts the rename first (not yet captured). Undoing a delete restores the device with its wires.

Builds and exports are planned for v2, and declarative graph specifications for v3.

## Safety

- Projects can only be opened or saved inside the allowed roots. Symlinks are resolved before the check.
- Saving never overwrites an existing file unless the tool call says so explicitly.
- Quitting always closes the project first, so World Machine shuts down normally and returns the licence seat; unsaved changes are discarded when the server stops.
- Opening or creating a project refuses to discard unsaved changes unless the tool call says so explicitly.
- There is no tool for running arbitrary World Machine console commands.
- World Machine log output, including licence information, is never returned to the AI assistant.

## Documentation

- [Design spec](docs/superpowers/specs/2026-10-04-worldmachine-mcp-design.md)
- [Feasibility findings](docs/research/2026-10-04-feasibility-findings.md)

## Licence

[MIT](LICENSE). World Machine is a trademark of its owner. This project is not affiliated with or endorsed by the makers of World Machine.
