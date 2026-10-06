# World Machine 4067 (Dragontail Peak), Linux AppImage: quit hangs after a stopped build

## Environment

- World Machine build 4067 (Dragontail Peak), Pro licence, x64-AVX2 Linux AppImage, Fedora 44.
- Started with `--cli`; commands are sent on stdin, one per line, and output is read from stdout.

## Issue 1: `system quit force` never completes after `build stop` of a large build

Steps (console):

1. `project new default force`
2. `scene resolution 4097`
3. wait about 8 s
4. `build start` (or `group build #0`)
5. wait about 2 s, then `build stop`
6. World Machine prints `Stop requested.` and `[Build Event] *** Build Ended ***`
7. `project close force`
8. `system quit force`

Observed: World Machine prints `Exiting World Machine...` and the window closes, but the process keeps running. After 120 s it had not exited, and the log has no `Shutdown: Removing autosave files on nominal exit` line. Waiting 15 s between step 6 and step 7 makes no difference. Only a signal (SIGTERM) ends the process. Reproduced with a full build and with a group build.

Expected: the process exits after `system quit force`, as it does when the build was not stopped (it then exits in about 0.1 s).

Effect: because the process has to be ended by a signal, the session is queued as a crashed session and offered for recovery at the next start (see issue 3).

Related: after a stopped 4097 full build, the line `Build started.` that normally follows a build (also after a stopped build at a small resolution) did not appear within 15 s.

## Issue 2: occasional crash on quit

Twice on 2026-10-06 (14:46:35 and 15:13:29), World Machine wrote a crash report while quitting after a session that included group builds and a stopped group build. Both reports have the same stack: the crash happens in a stdin socket-notifier callback (QSocketNotifier activated, frames at 0x8ea388, 0x894065, 0x86f53e, 0x88fd5a, 0x976c8b, 0x88ed95 in WorldMachineAVX2 above libQt6Core). A later run of the same sequence did not crash, so it is intermittent. The two reports are attached.

## Issue 3 (question): crash-recovery queue

Each unclean exit queues one crashed session. At the next start, a single queued session is restored silently. With more than one, a modal "Recover crashed session" dialog appears, and startup waits on it (no `Startup: Completed` line until it is answered). For console automation this blocks startup with no console-visible signal except the absence of the ready line after `Checking for session and autosave files`.

Questions:

- Is there a command-line option or setting to skip or auto-answer crash recovery when World Machine runs with `--cli`?
- Does Cancel discard a queued session, or keep it for the next start?
