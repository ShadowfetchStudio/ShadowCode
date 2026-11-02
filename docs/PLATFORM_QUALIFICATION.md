# Physical-machine platform qualification

## 2.3.2 candidate — November 1, 2026

This is a qualification record, not a claim that the candidate has been released.
Final package installation, hashes, screenshots, and website deployment receipts
will be added after the release builds. Prior evidence remains version-specific.

### Problems reproduced

- On Omarchy/Arch, the public 2.3.1 AppImage's engine CLI started, but its native
  window failed when WebKit looked for `WebKitNetworkProcess` at the Debian build
  host's absolute path. That path does not exist on Arch. Relocating the compiled
  helper paths then exposed an EGL initialization failure with the bundled stack
  and the host's newer Mesa drivers.
- The candidate relocates only the known, equal-length WebKit path strings,
  checks both helper executables, retains a before/after hash receipt and the
  relocation program in the package, and verifies the actual packaged library.
- The launcher can select a complete host WebKit/GTK stack when its helper layout
  differs from Debian. It refuses missing native dependencies or helpers. It keeps
  AppImage extraction ownership, does not disable the sandbox, and avoids probing
  the graphics stack for ordinary CLI commands. `SHADOWCODE_APPIMAGE_STACK` can be
  `auto` (default), `bundled`, or `host`; explicitly requesting an incomplete host
  stack fails rather than silently selecting it.
- The isolated candidate AppDir on Omarchy reached the native first-window-loaded
  marker after this change. This does not yet qualify a final signed 2.3.2 AppImage.
- The model picker could restore focus after model selection had already focused
  the composer. Typing a space could then reopen the picker. A deterministic unit
  regression failed before the fix. Close now respects focus moved outside the
  picker, including focus moved synchronously by the selection callback.
- Editor browser scenarios sent Control shortcuts on macOS; they now use the
  platform's Command editing and document-navigation shortcuts. Sidebar hints
  follow the viewing keyboard, including remote browsers.

### Installed-engine 2.3.1 baseline

The new `scripts/test-platform-runtime.mjs` was run on each physical machine's
installed native executable, with disposable profiles/projects and a loopback
scripted provider. Each passed 100 sequential tasks, 80 concurrent tasks, five
provider-stall cancellations, bounded resource growth, and retrieval of completed
and cancelled tasks after stopping and reopening the engine.

| Machine | Engine RSS, warm to final | Resource counts, warm to final | Result |
| --- | --- | --- | --- |
| Windows 11 x64 laptop | 23,964 → 32,856 KiB | 203 → 215 handles | Passed |
| Omarchy x64 laptop | 69,788 → 78,412 KiB | 18 → 18 file descriptors | Passed |
| Intel iMac, macOS 15 | 17,444 → 23,992 KiB | 15 → 15 file descriptors | Passed |

Raw versioned binary hashes and measurements are in
[`qa/platform-baseline-2.3.1/`](qa/platform-baseline-2.3.1/). Omarchy's native
executable was extracted from the publisher-authenticated installed AppImage.
The Windows installed runtime also passed the clean-PATH desktop, llama-server,
llama-cli, and isolated async CLI checks.

These engine results do not certify native rendering, inference-server memory,
real model quality/speed, GPU endurance, or cloud-provider accounts. Unix shutdown
uses SIGTERM; the Windows probe verifies persistence after forced termination and
does not claim graceful Windows shutdown. The original Linux stress suite keeps
its independent, stricter process-resource and SQLite-integrity coverage.

### Running the portable probe

Use Node 22 or newer. Set `SHADOW_STRESS_BINARY` to the installed native executable
(not an AppImage extraction wrapper or shell launcher), and optionally set
`SHADOW_STRESS_ARTIFACTS` to the output directory. Run:

```text
node scripts/test-platform-runtime.mjs
```

No API keys or downloaded model weights are required. This probe starts its own
loopback provider and engine and removes its temporary profile/project afterward.
It never runs tasks against the user's normal project or profile.
