# Windows port

Status: phase 1 (compile on Windows) done October 17, 2026; phase 2
(engine tests) started. Linux and
macOS ship today; Windows follows the path the macOS port took
([MACOS_PORT_ESTIMATE.md](MACOS_PORT_ESTIMATE.md)): compile, then make the
engine's tests pass, then the app, then packaging. Work happens on GitHub's
Windows runners (`.github/workflows/windows.yml`); no Windows computer is
needed for phases 1 and 2.

## Phases

1. **Compile.** The workspace builds on Windows (x86_64, MSVC). Unix-only
   code is gated `cfg(unix)` or given a Windows path.
2. **Engine tests.** Unit and integration tests run on the Windows runner;
   Unix-only tests are ported or gated with a reason.
3. **App.** The window, terminals, local models and the agent's tools work on
   Windows; checked on a Windows virtual machine.
4. **Packaging.** An installer (`.msi` or `.exe`) built by a release workflow
   and attached to each release like the macOS images and the Flatpak.

## Design decisions

| Area | Linux and macOS | Windows |
|---|---|---|
| Agent shell commands | `/bin/sh -c` | Git Bash (`bash -c`) when Git for Windows is installed, so the same commands work; otherwise Windows PowerShell. Never WSL's `bash.exe` in System32 |
| Shell sandbox | bubblewrap, Landlock, Seatbelt | An AppContainer: the project and a scratch folder writable, Windows and Program Files readable, read-only toolchain and PATH folders from the home folder, the rest of the home hidden; network off (no capabilities, loopback included) or on (internet and private-network capabilities). The allow-list is refused: the container cannot reach its proxy on this computer. Started through ShadowCode's own executable as a launcher (`--shadowcode-sandbox`). Inside it commands run in busybox-w32's `sh` (POSIX syntax), built from pinned source and bundled: Git for Windows' bash (MSYS2) cannot start in an AppContainer, and PowerShell cannot enter a project whose parent folders the container may not list. Without the bundled shell the sandbox is unavailable (refused under Require sandbox, else unsandboxed with a warning) |
| Process trees | process groups, signals, `/proc`, kqueue | Job objects: every command and helper runs in a job that is killed as a whole, and closes with ShadowCode |
| Terminals | PTY | ConPTY |
| Engine connection | Unix socket | Named pipe restricted to the user |
| API keys | Secret Service, Keychain | Windows Credential Manager |
| Settings and history | XDG folders, `~/Library` | Settings in `%APPDATA%\ShadowCode\config` (they roam with the account); history, models and caches in `%LOCALAPPDATA%\ShadowCode` |
| Local models | Vulkan, Metal | Vulkan and CPU builds of llama.cpp |
| Installer and updates | AppImage, deb, Flatpak, dmg | `.msi`/`.exe` from Tauri; the update notice names it |

## Progress

- Phase 1 (done): the whole workspace — engine, desktop app and every
  test target — compiles on Windows with warnings as errors. The Windows CI
  job reports every compile error at once (`--keep-going`) with the full log
  as an artifact.
  - The engine connection is a named pipe (`control/transport.rs`) that
    refuses remote clients, allows only this user's SID, and is checked by
    the client to be served by this user before anything is sent.
  - Folder syncs after a rename (`paths::sync_directory`) are skipped on
    Windows, which cannot open a folder as a file.
  - File opens never follow a final symlink on Windows either.
  - Not yet available on Windows, each with a clear error: subscription CLI
    backends (the vendor runner), terminals, removing isolated checkouts,
    and linking exported rules.
  - Integration tests built on Unix sockets, FIFOs, symlinks, file modes or
    the fake vendor CLIs (shell scripts) are Unix-only for now.
- Phase 2 (done October 18): the engine's unit tests (596; 554 of 605 on
  the first run) and integration tests (90 suites) pass on Windows and are
  required. Fixed along the way:
  - Randomness for remote-access tokens and the local server key comes
    from the system (getrandom), not `/dev/urandom`.
  - Canonical paths have no `\\?\` prefix (`paths::Canonical`, dunce), and
    project paths shown to the agent and in approvals use `/`
    (`paths::slash`); with `\`, deleting `.git\objects` was not recognized
    as unrecoverable.
  - Files are flushed and re-timed through a handle that may write, and
    folders are opened with backup semantics: Windows refuses otherwise
    ("Access is denied").
  - Commands and worktree setup scripts run in a job object, so cancelling,
    a timeout or closing ShadowCode ends everything they started.
  - Installed and free memory come from `GlobalMemoryStatusEx`; model file
    identity uses the volume serial, file index and change time.
  - Claude skill files are copied, not linked, beside a staged `SKILL.md`.
  - Managed worktree checkouts are removed with the same careful cleanup:
    identities are the volume serial and file index read from open handles,
    folders are never opened through links or junctions, and the exclusive
    rename is `SetFileInformationByHandle` without replacement. Git writes
    and lists its own paths with `/`, which the checks expect.
  - Background processes use the Windows shell, not `/bin/sh`.
  - Project paths in checkpoints, scope checks ("Only change these"), Git
    requests and folder listings use `/`; with `\`, an edit inside the
    chosen folder counted as outside it, and "Ignore this file" would have
    written an escape into `.gitignore`.
- Not on Windows yet, and the tests that need them are Unix-only (each says
  why): the vendor runner (subscription CLIs), terminals, local models (the
  llama.cpp runtime), the SQLite inspector, and test fixtures that are shell
  or Python scripts, Unix file modes, signals or file names.
- Preview installer: the Windows job also builds an unsigned NSIS
  installer (per-user) and checks that the app reports its version. It is a
  14-day CI artifact, not a release.
