# Physical-machine platform qualification

## 2.3.3 public release — November 2, 2026

Linux 2.3.3 is published. The Windows, macOS and Flatpak packages are also published.

On the Omarchy x64 laptop, the publisher-authenticated public AppImage was installed with the independently reviewed 2.3.3 trust bundle. The installed AppImage SHA-256 is `4d7b49048718bc7a25407362958ea63b7d5d69a66f23afc8a287274be3245747`; the extracted native binary is `6b47514c3028cc4e3e98d7bd2fa46f73a437d5883dd8551278d3b0e4da3d04f7`. The installer required and observed the first native window.

A focused test on the laptop's actual Wayland compositor passed 12 interface checks, including onboarding, provider discovery (including Grok), accessibility, a scripted-provider task with approved file writing and command execution, and clean app shutdown. It excludes the floating-window sizing and resize tests, recovery and the full UI endurance suite. Separately, the extracted installed engine passed 100 sequential and 80 concurrent tasks, five cancellations and persistence after a graceful stop. That probe uses a loopback scripted provider: it does not demonstrate real-model inference or inference-server memory behavior. The [installation receipt](qa/platform-release-2.3.3/omarchy-installation.json), [Wayland interface results](qa/platform-release-2.3.3/omarchy-native-wayland.json), and [endurance results](qa/platform-release-2.3.3/omarchy-endurance.json) retain the hashes and measurements.

On the Windows 11 x64 laptop, the public 2.3.3 installer (SHA-256 `f6991390e42d0fd85e2456b95e6209053bf9db35ff94ed940df2bf7fd71e65c3`) installed successfully and passed clean-PATH runtime probes. Native WebView checks verified editor find/replace, undo, both redo shortcuts, saving and Settings without reported JavaScript errors. The installed engine also passed 100 sequential and 80 concurrent tasks, five cancellations and persistence after forced process termination, using a scripted provider. A real Gemma 4 E4B local CPU coding task also passed in 662 seconds; the agent ran the original five tests, which were preserved and passed again independently. This one task does not establish broad model quality or GPU inference. See the [real-model result](qa/platform-release-2.3.3/windows-real-model.json), [installation](qa/platform-release-2.3.3/windows-installation.json), [native interface](qa/platform-release-2.3.3/windows-native-webview.json) and [endurance](qa/platform-release-2.3.3/windows-endurance.json) receipts.

On the Intel iMac, the public 2.3.3 disk image (SHA-256 `f6c886915951d77c1d9d6e50add2d4d0647347bb66563fc6c946fef81da3e39e`) installed and passed version, isolated CLI and bundled runtime startup checks. The installed native executable passed 100 sequential and 80 concurrent scripted-provider tasks, five cancellations and persistence after graceful shutdown. A separate isolated-profile launch produced the expected 2.3.3 first-window marker and a visible native window. Screen capture was not authorized, so the physical iMac check does not establish visual content, editing or keyboard interaction; real model inference and inference-server memory were not tested. See the [installation](qa/platform-release-2.3.3/imac-installation.json), [window](qa/platform-release-2.3.3/imac-native-window.json) and [endurance](qa/platform-release-2.3.3/imac-endurance.json) receipts.

Earlier candidate evidence below is version-specific.

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

- Physical desktop testing also reproduced Grok's interactive `authenticate` flow
  opening a browser during background discovery. The probe now authenticates only
  through known existing-login methods; other advertised methods use `session/new`
  to check an existing login and leave interactive authentication to explicit Connect.
  A regression covers both an existing session and authentication-required responses.

### Physical Wayland packaging experiment

A focused native-window smoke ran on the actual Omarchy Hyprland compositor with
its existing tiling and scale. It passed 12 checks: onboarding, picker and refresh,
local test-model registration/selection, accessibility checks, approved file-write
and command execution, the completed task summary, and application/child shutdown.
The executable was the 2.3.1 baseline in an isolated AppDir with the candidate
launcher and library relocation. A scripted test server supplied model responses;
this is neither real inference nor final 2.3.2 package qualification.

The unmodified upstream desktop suite first rejected the compositor's tiled size
because it expected a floating window fitted to 90% of the screen. That failure
is retained. The focused smoke explicitly excludes floating-size policy, scripted
resizing, recovery and endurance. Grok was excluded from the successful baseline
smoke after its unsolicited login was reproduced; candidate Grok discovery has
separate regression coverage and still needs final physical-package verification.

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
