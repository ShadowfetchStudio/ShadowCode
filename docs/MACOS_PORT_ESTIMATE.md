# macOS port: build estimate

Status: phase 1 done (see Progress); the rest is an estimate. Figures are judgement from a source survey
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

**Phase 2 has started.** All 640 engine unit tests that build on macOS pass
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

Still open in phase 2:

- `worktrees::cleanup` (stale worktree cleanup) is Linux-only (`/proc`).
- Redaction's high-entropy rule treats `/` as part of a token, so macOS's
  per-user temporary folder (`/var/folders/<random>/T/…`) is masked as a
  secret wherever text is redacted. Safe (over-redaction) but noisy; a
  path-aware rule must not let base64 secrets with slashes through.
- Integration tests (`native/core/tests`), the shell sandbox (Seatbelt),
  Keychain, the PTY relay, GUI `PATH`, process control (kqueue), macOS paths
  (`~/Library`), the window, and Metal llama.cpp, per the table below.

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
