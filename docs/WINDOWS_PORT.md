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
| Shell sandbox | bubblewrap, Landlock, Seatbelt | No equivalent with the same guarantees. Commands run unsandboxed with the existing warning, and **Require sandbox** refuses them, until a Windows design (AppContainer or a restricted token plus a job object) is reviewed |
| Process trees | process groups, signals, `/proc`, kqueue | Job objects: every command and helper runs in a job that is killed as a whole, and closes with ShadowCode |
| Terminals | PTY | ConPTY |
| Engine connection | Unix socket | Named pipe restricted to the user |
| API keys | Secret Service, Keychain | Windows Credential Manager |
| Settings and history | XDG folders, `~/Library` | `%APPDATA%\ShadowCode` (cache in `%LOCALAPPDATA%`) |
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
- Phase 2 (started): the CI job runs the engine's unit tests on Windows and
  lists the failures; it does not block yet.
