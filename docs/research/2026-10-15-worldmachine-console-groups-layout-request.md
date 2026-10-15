# World Machine 4067 (Dragontail Peak): console commands for groups and device positions

## Environment

- World Machine build 4067 (Dragontail Peak), Pro licence, x64-AVX2 Linux AppImage, driven through its command-line console (`--cli`).

## What the console can do today

Groups can be listed, enabled, disabled, and built:

```
>>> help group
group commands:
  group build <name|#index>       Build all devices in a group
  group disable <name|#index>     Disable all devices in a group
  group enable <name|#index>      Enable all devices in a group
  group list [filter]             List all groups
```

The only layout command is `device organize` ("Organize devices by processing order"). `device info` shows a device's name, type, enabled state, and bypass state, but not its position or its group.

## What is missing

There is no console command to create, rename, or delete a group, to add a device to a group or remove it, or to read or set a device's position in the graph view. Commands with these names are not hidden either; each one is refused:

```
>>> group create Probe
Error: Unknown command: 'group create'. Type 'group' for available subcommands.
>>> group add Probe #1
Error: Unknown command: 'group add'. Type 'group' for available subcommands.
>>> device move #1 100 100
Error: Unknown command: 'device move'. Type 'device' for available subcommands.
>>> device position #1
Error: Unknown command: 'device position'. Type 'device' for available subcommands.
```

(Also tried, with the same answer: `group new`, `group assign`, `group remove`, `group delete`, `group rename`, `device group`, `device pos`, `device setpos`, `device place`, `device location`. `debug list` shows no variable for positions or membership.)

## Why it matters

A graph built from the console, by a script or a tool, ends up with every new device placed by World Machine and outside every group. `device organize` arranges the graph by processing order, but it cannot keep a layout someone designed, and the devices a script adds cannot join the groups that the default project's tutorial and many users rely on (`group build` and `group enable` only work on groups made in the window). So a scripted graph has to be finished by hand in the window.

## Requests

Any of these would help, roughly in order of value:

1. `group add <group> <device>` and `group remove <group> <device>`, with devices by name or `#<id>` as the other device commands take them.
2. `group create <name>` (optionally with a list of devices), `group rename <group> <name>`, and `group delete <group>` (keeping its devices).
3. `device info` showing the device's position and its groups, and `device move <device> <x> <y>` (in graph-view units) to set the position.

The existing `#<index>` and `#<id>` reference styles and the existing confirmation-line style (`Enabled <n> device(s) in group '<name>'`) would fit these as well.
