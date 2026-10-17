# macOS port: build estimate

Status: released. ShadowCode 2.2.0 (October 17, 2026) is the first release with macOS disk images for Apple silicon and Intel (see Progress). The estimate below is the original one. Figures are judgement from a source survey
(~135k lines of Rust in `native/core` and `src-tauri`), not measurements.

## Summary

- Total: **17–36 engineer-weeks** (midpoint ~24), plus QA and buffer.
- Tauri 2 and most dependencies (rusqlite, reqwest/rustls, tokio, ratatui) are
  already cross-platform, and much code is gated `cfg(unix)` rather than Linux.
- First blocker: the ungated `gdk` dependency in `src-tauri/Cargo.toml`, plus
  `/proc`, D-Bus and namespace code that needs `cfg(target_os = "linux")`.

## Progress

**Phase 1 (compile on macOS): done.** On macOS 15 (Intel iMac, Xcode 26.3)
the whole workspace compiles and `cargo clippy --workspace --all-targets -- -D
warnings` is clean. It took two fixes: voice capture's `cpal` is now a macOS
dependency too (CoreAudio), and the control socket probe sets non-blocking and
close-on-exec with `fcntl` where `SOCK_NONBLOCK`/`SOCK_CLOEXEC` don't exist.
The `gdk` dependency was already Linux-only. `.github/workflows/macos.yml`
keeps it compiling on GitHub's macOS runner.

**Phase 2 (engine on macOS): done.** All 640 engine unit tests that build on macOS pass
there (Linux: 664). Fixed on the way, each a real macOS gap:

- Workspace opens through cap-std now also set `FollowSymlinks::No`: on macOS
  cap-std resolves paths itself and followed a final-component symlink before
  `O_NOFOLLOW` reached the last `openat`.
- Absolute paths naming the workspace through a symlinked folder (`/var` is
  `/private/var`, as is every temporary folder) were refused as outside it.
- Remote access's "own settings folder" refusal missed a folder that does not
  exist yet under a symlinked profile path (both systems).
- Backups found their open folder through `/proc/self/fd`; on macOS they now
  ask the kernel with `fcntl(F_GETPATH)`, so a symlink swapped in at the
  folder's name is never written through.
- Rules exported to a vendor CLI were recognised as linked only when the
  paths matched as written; they are compared by real location now.

Integration tests (`native/core/tests`): all 1,400-odd pass on macOS too
(one language-server test can report "server too slow" under full-suite
load on a 4-core Intel iMac; it passes alone), after these product fixes:

- Sessions and managed checkouts record the folder's real path, so a
  session opened through `/var/…` still matches its workspace.
- SQLite inspection opened databases through `/proc/self/fd`. On macOS a
  name under a reserved prefix stands for the held directory, and SQLite's
  own `open`/`stat` calls for it become `openat`/`fstatat` on that
  directory, never following a final link.
- Terminals: `openpty`, with the session's members found through
  `proc_listallpids` and `getsid` so hang-up reaches job-control groups.
- Installed memory for local models comes from `hw.memsize` (was 0 GB).
- Worktree cleanup, which keeps a checkout deleted outside ShadowCode
  recoverable, runs on macOS (`F_GETPATH`, `renameatx_np(RENAME_EXCL)`);
  the looser fallback is gone.
- A profile rule's id stays relative when discovery names it by real path.

The tests themselves no longer read `/proc` to decide whether a process is
alive (it passed vacuously on macOS; `proc_pidinfo` there) and no longer
need GNU `touch -d` or `setsid(1)`. Three paused-clock tests (two streams,
one download) are Linux-only: the paused clock races real loopback I/O on macOS, and the
timing logic they cover is the same everywhere. To run the suite on a Mac,
build the app first (`cargo build -p shadowcode-desktop`; the real-engine
tests start it), then `cargo test -p shadowcode-core --tests`.

**Phases 2–3 (runs as a Mac app): done, unsigned.** `scripts/build-macos-app.sh`
builds `ShadowCode.app` and `ShadowCode_<version>_<arch>.dmg` (ad-hoc signed,
macOS 12 or later) with the Metal llama.cpp runtime inside. On the Intel
iMac the app opens from Finder, doctor passes, and the local engine reports
`metal` on its Radeon Pro 555X. What the Mac now does like Linux:

- **Folders:** settings and history in `~/Library/Application Support/ShadowCode`,
  cache in `~/Library/Caches/ShadowCode`, the user-installed runtime in
  `…/ShadowCode/llama.cpp`, the bundled one in `Contents/Resources/llama.cpp`.
- **`PATH`:** opened from Finder or the Dock, the app asks the login shell
  for its `PATH` once, so Homebrew Git, Node and the vendor CLIs are found.
- **Shell sandbox:** Seatbelt (`sandbox-exec`) mirroring bubblewrap: reads
  only in system, developer and package-manager folders, the project and
  the toolchain folders (the rest of the home folder and other volumes are
  hidden, even from `stat`); an empty `HOME` linking to read-only
  toolchains; writes only in the project and scratch; network off (no IP
  at all, localhost included), on, or only the allow-list proxy's port.
  `DEVELOPER_DIR` keeps Apple's git/clang shims fast and quiet inside it.
- **Keychain:** "Move to keyring" keeps API keys in the login Keychain.
- **Processes:** stopping work reaches every descendant
  (`proc_listchildpids`); helpers die with ShadowCode through a kqueue
  watcher where Linux uses `PR_SET_PDEATHSIG`.
- **Terminals** (`openpty`), the **dev-server preview** (`lsof` + libproc),
  **worktree cleanup** (`F_GETPATH`, `renameatx_np`), **SQLite inspection**
  (SQLite's open/stat routed through the held directory) and **installed
  memory** (`hw.memsize`).
- **Local models:** llama.cpp with Metal and the same loadable CPU
  variants. Its shaders are compiled at build time: compiling them at run
  time took 55 s on first use and hung outside a desktop session.

Distribution is GitHub only (no App Store, no notarization):
`.github/workflows/release-macos.yml` builds the `.dmg` for Apple silicon
(`macos-15`) and Intel (`macos-15-intel`) when a release is published,
smoke-tests the app, and attaches both with `ShadowCode_<version>_macos.sha256`
(on pull requests touching macOS packaging it only builds).
`scripts/install-macos.sh` installs or updates from a release after checking
that checksum; files fetched with curl are not quarantined, so Gatekeeper
does not block the un-notarized app. The update notice names that command.

Still open:

- **Publisher signatures for the macOS images.** They are checked against
  the release's SHA-256 file over HTTPS, not signed with the release key:
  that needs macOS targets in `release/trust/policy` and the signing tools.
- **Apple silicon** builds (`aarch64-apple-darwin`) are untested: there is
  no arm64 Mac here. The runtime build already has the M1–M4 CPU variants.
- **Real model runs** on the Mac: the runtime loads and sees the GPU, but no
  GGUF was available to generate with.
- Redaction's high-entropy rule masks macOS's per-user temporary folder
  (`/var/folders/<random>/T/…`) as a secret. Safe but noisy; a path-aware
  rule must not let base64 secrets with slashes through.

## Work items

| Area | Main files | macOS approach | Weeks | Risk |
|---|---|---|---|---|
| Sandbox (bwrap, Landlock, netns) | `native/core/src/sandbox.rs`, `sandbox/{netns,lsm,proxy}.rs` | Seatbelt (`sandbox-exec`) profile + localhost proxy; no PID/IPC isolation | 3–6 | Highest: security semantics differ |
| Keyring | `native/core/src/keyring.rs` | Keychain (`security-framework`) | 1–2 | Needs stable code signing |
| PTY relay | `native/core/src/terminal.rs` | posix_openpt fd-flag/ioctl fixes, zsh default | 0.5–1.5 | Low–med |
| `/proc` usage | `preview/ports.rs`, `process.rs`, `worktrees/cleanup.rs` | `libproc`, `sysctl` | 1–2 | Medium |
| Paths | `paths.rs` | `~/Library/...` | 0.5–1 | Low |
| Window logic | `src-tauri/src/window_size.rs` | Gate GDK code; app menu, WKWebView QA | 1–2 | Low–med |
| llama.cpp | `scripts/build-llama.cpp.sh`, `local_runtime.rs`, `local_engine.rs` | Metal build, arm64 only | 1.5–3 | Medium |
| Packaging, signing, updates | `scripts/`, `packaging/`, `updates.rs` | `.app`/`.dmg`, codesign + notarytool, updater | 3–5 | Med–high |
| Shell / GUI `PATH` | `git_hooks.rs`, `updates.rs`, others | BSD tools, bash 3.2, Homebrew paths | 1–2 | Medium |
| Process control | `process.rs`, `cli_agent/runner.rs`, `control.rs` | kqueue `EVFILT_PROC` instead of PDEATHSIG | 1–2 | Medium |
| Voice | `voice/capture.rs` | cpal CoreAudio, mic entitlement | 0.5–1 | Low |
| Notifications | `src-tauri/src/notices.rs` | tauri-plugin-notification | 0.25–0.5 | Low |
| Desktop metadata | `packaging/*.desktop`, appdata | Info.plist, `.icns` | 0.5 | Low |
| CI | `.github/workflows/*` | `macos-14/15` jobs, signing secrets | 1.5–3 | ~10x runner cost |
| Tests and docs | tests across crates, docs | Gate or port Linux-specific tests | 1–2 | Low–med |

## Phases

1. **Compile on macOS (1–2 wk):** gate Linux-only code; add a macOS CI build.
2. **Unsigned MVP (6–11 wk):** paths, PTY, GUI `PATH`, Keychain, libproc,
   kqueue, window gating, Metal llama.cpp, a Seatbelt sandbox shown as
   reduced isolation (or every command asks) — never silently unsandboxed.
3. **Signed, notarized beta (4–8 wk):** Developer ID ($99/yr), hardened
   runtime, sign nested binaries inside-out, notarize in CI, updater,
   hardened Seatbelt, SECURITY.md update.
4. **Parity (6–15 wk):** full macOS test matrix, clean-VM smoke tests,
   network-isolation parity, Metal tuning, optional Intel/universal, Homebrew cask.

## Key risks

1. Sandbox guarantees can't be matched exactly; needs a product decision.
2. Notarization of nested executables (llama-server, helpers).
3. GUI-launched apps lack the shell `PATH`, breaking CLI detection.
4. ~17k lines of Linux-specific release tooling to parallel and maintain.
5. macOS CI cost and no Docker-style clean-host testing.
