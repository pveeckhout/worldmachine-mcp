# Plan 1 backlog

Open items left after Plan 1 (foundation) merged on 2026-10-05, taken from the implementation ledger. Items fixed before merge are not listed. Inputs for Plan 2.

## Plan 2 prerequisites

- **Re-capture V6 (`param set` value syntax).** `param set Height Output.<p> ...` failed with "No device selected" for a device name containing a space, while `param get` accepted the same reference. `bool`, `enum`, `filename`, and `float` values were never exercised. Re-capture with `device select` first, a quoted reference, or `#<id>`, and an explicit `float` parameter. See `docs/research/2026-10-04-cli-verification.md`, V6.
- **Quoting (V4).** Names with spaces work unquoted only as the final argument. Elsewhere use double quotes or `#<id>`; `#<id>` is preferred. Single quotes were not tested in a non-final argument.
- **V3.** `project new default force` yields the same 17 devices as the startup sample project.
- **V7.** Whether `project open` prompts when the project has unsaved changes is untested.
- **V8.** Licence checkout failure was never observed. It currently surfaces as `START_FAILED` through the exit-before-ready or readiness-timeout paths.

## Decisions deferred to the Plan 2 spec

- `CRASHED` doubles as the "not running / shutting down" refusal. Spec section 8 defines it as an unexpected exit.
- A `START_FAILED` hint for display errors (`qt.qpa.xcb: could not connect to display`), pointing users to the README's Linux display variables.
- The dirty-state wording of `CRASHED` (spec section 8). No Plan 1 code sets `dirty`.

## Must land before Plan 2's write tools

Done in Plan 2b (all four items below).

- `command-builder.ts`: the control-character class lets C1 controls (U+0080-U+009F) and U+2028/U+2029 through in the tail. Widen it.
- `command-builder.ts`: a free-text tail ending in ` force` could be read as a trailing flag on commands that accept one.
- `command-builder.ts`: the REFUSED message and doc comment still say quoting is "unverified".
- `test/fake-wm/fake-wm.mjs` (Plan 2a): `param set` splits the device reference at the first space, so `param set "Height Output".exportAlways true` echoes the wrong reference. Real output is `Set Height Output.exportAlways = true` (`raw/v6b-param-set.txt` l.55). No Plan 2a test uses it; fix it before Plan 2b tests rely on it.

## Plan 2b gate (from the Plan 2a final review)

Done in Plan 2b (all items below; the fake's `device add` follows ruling P9).

- **Bug in merged code:** `parsers/device-list.ts` keeps World Machine's state marker in the name (`Gradient                 [disabled]`, spec fact 24). `list_devices` and `inspect_project` report a wrong name, and `get_device` by name fails with `UNEXPECTED_OUTPUT` for any disabled or bypassed device. Parse the marker into a state field.
- Reopen the last clean opened project after an idle quit or crash (spec section 6). Without it, edits after a restart land in the default project.
- `world-machine-project-writer.ts`: after an unconfirmed lifecycle command (`UNEXPECTED_OUTPUT`), the binding and `dirty` go stale although World Machine may have acted. Mark dirty before checking undo/redo confirmations; bind `fresh` (or mark unhealthy) after an unconfirmed open or create.
- `world-machine-graph-reader.ts`: a device name shared by several devices resolves to the first listed id. Refuse ambiguous names with `REFUSED` and ask for `#<id>` (spec section 9).
- `test/fake-wm/fake-wm.mjs`: `device add` marks the project modified but adds no device, so an empty project still lists none (ruling P9).
- Move `ProjectCommandView` out of `open-project-command.ts` into its own file.
- `create-server.test.ts`: call `get_device`, `get_scene`, and `inspect_project` with fixture-built parser output, so parser output and output schemas are checked together.

## Plan 2c gate

Done in Plan 2c, except the fake's `param set` value rejection: it stays deferred, because no Plan 2c test sends a value through the fake's `param set` (the parameter editor's tests replay captured output through a scripted session).

- `src/application/port/out/world-machine-session-port.ts:14-16`: the `forgetReopen` doc comment was inserted between `exclusive`'s doc comment and `exclusive`, so that comment now sits above the wrong member. Move it back.
- `test/fake-wm/fake-wm.mjs`: `param set` accepts values the real World Machine rejects: `1.5 km` and `1,5` for a float, `3.0` for an int, an unknown enum value (`raw/v6b-param-set.txt` l.96-97, 102-103, 117-118, 177-178). `update_device_parameters` must refuse these before sending (spec section 7); if a 2c test sends one through, the fake needs per-parameter type data first.
- Edit tools resolve names with `resolveDeviceReference` after their own `device list`, inside `exclusive()` (Plan 2b ruling C1).
- `test/fake-wm/fake-wm.mjs`: `device select` matches exact case and only Erosion/#35, so added devices cannot be selected (fact 31, ruling P9). Fix it before a 2c test selects an added device.
- `add_device` and `rename_device` must refuse names that `device list` cannot read back unambiguously: a trailing ` [disabled]` or ` [bypassed]`, a `  (x)` suffix after two or more spaces, and leading or trailing whitespace.
- Output schemas allow unknown keys, so a new view field missing from a schema passes the Plan 2b schema tests. 2c's new view fields need `z.strictObject` or a type tie (`satisfies`) to the domain types.

## Test coverage gaps

- `create-server.ts`: the rethrow path for a non-`WorldMachineError` is untested. The SDK forwards its message unfiltered, bypassing the licence filter and the payload shape. Consider wrapping it in `respond()` as an internal error.
- `create-server.test.ts`: `destructiveHint: false` is not asserted.
- `tool-result.ts`: the "omit `worldMachineMessage` when only licence lines remain" branch is untested.
- `schemas.ts`: the zod output schemas are not type-tied to `StatusView` and `DeviceSummary`. Use `satisfies` or `expectTypeOf` before adding 16 more tools.
- `world-machine-process.ts`: the spawn `'error'` path, a pre-aborted signal, and a plain licence line in the startup detail are untested.
- `world-machine-session.test.ts`: a timeout during the shutdown drain has no dedicated test. The shutdown-drain test depends on microtask ordering (it fails loudly, never falsely).
- `path-policy.test.ts`: the identical-message test does not cover the inside-root extension/regular-file branch.
- Smoke tests: no coverage of the SIGINT/SIGTERM paths or of invalid configuration exiting with code 1.
- `session.test.ts`: no fresh-binding / `dirty: false` case for `summarize()`.
- `parseSystemInfo` takes the last of duplicated `Version`/`Arch` lines without complaint.

## Robustness and hygiene

- `LOG_LINE`/`LICENCE` exist three times: `src/domain/errors.ts` (`worldMachineText`), `src/adapter/out/worldmachine/log-lines.ts`, `src/logger.ts`; the domain should own them and the adapters import them.
- `session.ts`: `summarize()` has no `never` exhaustiveness check.
- `config.ts`: relative `WORLD_MACHINE_ALLOWED_ROOTS` entries resolve against `process.cwd()` instead of the injected `cwd`.
- `logger.ts` and `log-lines.ts` duplicate the licence regex, and `emit()` itself does not filter.
- `path-policy.ts`: a root that is a regular file counts as configured, so requests get `REFUSED` instead of `NOT_CONFIGURED`.
- `command-queue.ts`: `onExit` registered after the process already exited never fires; the write-throw path rejects with an untyped error.
- `world-machine-process.ts`: between `'exit'` and `'close'` (at most 1 s), `exited` is false and `write()` accepts input.
- `world-machine-session.ts`: a shutdown arriving while a failed setup is already quitting waits about 4 s (`kill()` still reaches the process). `status()` can briefly show `ready` during shutdown if the last setup command completes inside the drain window.
- `main.ts`: with `process.on`, a repeated Ctrl-C cannot exit a hung server (MCP clients escalate to SIGKILL).
- `README.md`: the Claude Code example can set empty `WAYLAND_DISPLAY`/`XAUTHORITY`.
- `package.json`: add `prepublishOnly: npm run build` before the first publish.
- Capture script: async log lines between batches are attributed to the next batch's first command. `check-fixtures` patterns miss `/root/`, email addresses, and unscrubbed `/tmp` or `/var/folders` paths; widen them before the next capture.
- Test temp directories leak: `locator.test.ts`, and `live.test.ts` (created at collection even when skipped).
- Plan 2c final review, `world-machine-device-editor.ts`: the enable/disable read-back should require the `Selected:` line and compare the read-back name with the target (the 23-character rule of fact 33).
- Plan 2c final review, `connect_devices`: "an existing wire is left alone (`created: false`)" does not hold when the source name is shared by several devices; add a caveat to the tool text or a source-side wire check.
- Plan 2c final review: the "at least one" rules for `configure_scene` and `update_device_parameters` are enforced by the editors but absent from the input schemas.
- Plan 2c final review, test gaps: missing `Enabled:`, `Disabled:`, and `Deleted:` confirmations; a command-level `Error:` for enable and delete; read-back error batches for disconnect.
- Next live capture: the undo step count for add-then-rename, and `device add` of a type whose default name is longer than 23 characters (the add echo comparison is Assumed).
