# Physical-machine platform qualification

## 2.4.1 public release

[ShadowCode 2.4.1](https://github.com/ShadowfetchStudio/ShadowCode/releases/tag/v2.4.1), release `442808765`, was published on **November 12, 2026 at 10:46:44 UTC**. Immutable tag `v2.4.1` resolves to release source `a3b09eca6333c2befda3504850f357f09cc25542`.

All four release workflows completed successfully on that source, attempt 1:

| Platform | Release run | Result |
| --- | --- | --- |
| Linux | `43192014736` | success |
| macOS | `43203354756` | success |
| Flatpak | `43203358489` | success |
| Windows | `43203362035` | success |

The [public artifact audit](qa/platform-release-2.4.1/public-assets/verification-summary.json) passed at **11:28:33 UTC**. All **23 assets, totaling 717,415,098 bytes**, matched their immutable API IDs, sizes, digests and downloaded SHA-256 values. The contract includes nine installers, three source archives and five checksum sets with 12 payload rows. The tag and asset inventory remained unchanged across verification. [Workflow results](qa/platform-release-2.4.1/public-assets/workflow-results.json), [full inventory and hashes](qa/platform-release-2.4.1/public-assets/audit-result.json), [checksum verification](qa/platform-release-2.4.1/public-assets/checksum-verification.json), and [Linux signature verification](qa/platform-release-2.4.1/public-assets/linux-signature-verification.json) retain the exact evidence.

Six Linux payloads authenticated against the reviewed Ed25519 trust bundle and matched the main-reviewed handoffs. This authentication covers the two AppImages, two DEBs and two runtime-source archives. It does not cover DMGs, Flatpaks or Windows assets; checksum verification establishes no Developer ID, notarization or Authenticode claim.

### Public Windows installation and qualification

The public installer `ShadowCode_2.4.1_x64-setup.exe`, immutable asset `739178661`, is **23,870,723 bytes**, SHA-256 `d979725fe94ddb405d6180a73c8c48a268bff4ceeb51265d432fa09d5e4b8f99`. The [public download proof](qa/platform-release-2.4.1/windows-public-integrity.json) matched the API digest and published checksum before installation.

The [installation receipt](qa/platform-release-2.4.1/windows-installation.json), SHA-256 `c887fdfe9ec15321503255b2c339cd52a64f20ad54fa51399a10b670eed22147`, binds the installed executable to the exact `shadowcode.exe` member independently extracted from that installer with 7-Zip 26.05. Both executable hashes are `abf7a230373dccd37e3bdb537eba32b830cb8fd7223e3ef64b40ded4c67ba058`. The receipt retains the payload path, extractor hash and version, and installer identity. This distinguishes the public binary from earlier candidates with the same version number.

- **Installation and clean-PATH runtime: PASS.** The [original runtime log](qa/platform-release-2.4.1/windows-installed-runtime.txt) records the installed app version, isolated-profile status, and bundled llama-server/llama-cli checks.
- **Native UI: PASS.** The [UI receipt](qa/platform-release-2.4.1/windows-native-ui.json), [runner](qa/platform-release-2.4.1/windows-ui-runner.json) and [checkpoint](qa/platform-release-2.4.1/windows-ui-checkpoint.json) record eight check groups, nine native window/zoom cases and all 45 Hide-control hit points. Conversation creation retained three distinct selected IDs as the count increased from one to three. Onboarding, editor/draft behavior, terminal checks and Settings completed without UI errors; the app and runner exited normally and cleanup passed. Requested 1440-wide cases were limited to the recorded 1366-wide work area; the receipt preserves actual native/CSS dimensions. Native WebView automation does not establish physical-keyboard/OS-shortcut arbitration or native accessibility acceptance.
- **Scripted native-engine endurance: PASS.** The [result](qa/platform-release-2.4.1/windows-endurance-result.json), [public installation binding](qa/platform-release-2.4.1/windows-endurance-public-artifact.json) and [checkpoint](qa/platform-release-2.4.1/windows-endurance-checkpoint.json) record 100 sequential tasks, 80 concurrent tasks, five cancellations and persistence after stop. Sampled peak engine RSS was **31.96 MiB**, growth **8.50 MiB**, with **+12 handles and +2 threads**. Shutdown used **forced termination; graceful shutdown was not tested**. This exercised the installed native engine with a loopback scripted provider, not desktop UI, paid providers, real-model inference or inference-server memory.
- **Real-model qualification: PASS.** One **Gemma 4 E4B Q4_0 CPU** coding fixture completed in **808.64 seconds**, starting at **2026-11-12 11:23:43 UTC**, on the exact public installed binary. It corrected `clamp`, `unique` and `chunks` in `helpers.py`. The agent ran `python3 -m unittest -q` successfully; an independent run passed the same five original tests, whose bytes and SHA-256 remained unchanged. Bounds were a **16,384-token context, 100,000-token task budget and 1,800-second timeout**. The recorded test command used AppContainer with network off. Two non-Git write-delegation guard errors were recovered without human intervention; no Git repository was created. The bundled runtime remained unchanged and owned cleanup completed normally. This is one bounded coding fixture, not general model quality, GPU performance, an inference-speed benchmark or broad security certification. See the [model result](qa/platform-release-2.4.1/windows-model-result.json), [checkpoint](qa/platform-release-2.4.1/windows-model-checkpoint.json), [independent test log](qa/platform-release-2.4.1/windows-model-independent-tests.txt), [AppContainer proof](qa/platform-release-2.4.1/windows-model-appcontainer-proof.json), and [recovered guard-error evidence](qa/platform-release-2.4.1/windows-model-delegation-context.json).

### APT and other physical-platform scope

[APT verification](qa/platform-release-2.4.1/apt-public-verification.json) passed at **10:50:26 UTC**, after release job `131132225135` completed. Both `InRelease` and detached `Release.gpg` signatures verified against the independently tracked key; the live armored and binary keys matched fingerprint `1BC07B5ECFDB514673A296FB021CAB3F2F7A1F61`. Six signed index sizes/hashes and decompressed package indices matched. The amd64/arm64 entries identified 2.4.1 and both pool DEBs were byte-identical to the verified public release packages. The verifier installed no package.

**No new physical Mac/Linux installation acceptance was performed for 2.4.1.** Its evidence covers source CI, release packaging, public-byte integrity and Linux authentication/APT verification. Build success and browser fixtures do not establish physical native visual, accessibility, model or endurance acceptance. Earlier physical 2.3.3 results remain separately dated history.

The [dated 2.4.0 resolution-note readback](qa/platform-release-2.4.1/known-issue-resolution.json) records its update at **2026-11-12 11:39:32 UTC**, verified at 11:39:45 UTC with assets unchanged. The older failures and incomplete checks below remain historical results.

### Source validation and release prerequisites

Release source `a3b09eca6333c2befda3504850f357f09cc25542` has **928 passing UI unit tests, 170 passing full Chromium tests and eight passing focused WebKit tests**, with no failures or skips in those runs. See [source test verification](qa/onboarding-navigation-2.4.1/verification.json), [source CI](qa/source-ci-2.4.1/verification.json), [Windows source CI](qa/source-ci-2.4.1/windows-source-run.json), and the [two native 100-task CI receipts](qa/source-ci-2.4.1/native-endurance-summary.json). Source/fixture results are separate from installed-public qualification.

Both [x86_64](qa/platform-release-2.4.1/x86_64-handoff.json) and [aarch64](qa/platform-release-2.4.1/aarch64-handoff.json) passed all 15 required handoff gates. [Signing approval](qa/platform-release-2.4.1/signing-approval.json) was recorded at **10:44:07 UTC** after those independent main-reviewed checks and source/protection readbacks. The [a3b candidate UI checkpoint](qa/windows-candidate-a3b09ec/summary.json) remains a separate pre-publication record; its endurance/model checks were not run and it is not reused as public acceptance.

## Historical qualification records

The following records retain their original results and then-current pending statements. Neither later fixes nor publication convert earlier failures/incomplete checks into passes.

## 2.4.1 replacement candidate bf62 — held, not published

Candidate `bf62e846f57d91df06aca3ab40158c0c7e5aee63`, Windows run
`43176133588` attempt 1, artifact `13924953752`, installed successfully. The
installed executable matched the payload independently extracted from the exact
installer. See the [identity and receipt hashes](qa/windows-candidate-bf62e84/summary.json).

The first native UI attempt failed conversation selection after creation. Source
review found that a delayed post-onboarding boot can override newer navigation;
the retained database is consistent with that race but does not establish its
exact asynchronous ordering. An unchanged second attempt passed all nine window
and zoom cases, all 45 Hide-control hit points, editor/draft checks and terminal
continuity. Its final Settings check failed because a broad test locator matched
two buttons. Both attempts remain failed overall. A sidebar-scoped locator was
reviewed separately; no startup wait is being added to hide the product race.

This candidate was not tagged or published. Navigation ownership must be fixed
and a fresh installer must pass the complete native check. No endurance or
real-model test was run for this candidate. Native WebView automation does not
establish physical-keyboard or OS-shortcut arbitration.

## 2.4.1 initial candidate — failed, not published

Candidate `3984b7f5dfe39976c1eb3c1aec2a71de5b2c9666` installed successfully on
the Windows laptop from Actions run `43166081351`, attempt 1, artifact
`13921472078`. Installer SHA-256:
`0069257d0b2eaa8ee223a537feb1fd20ae6307cebf926907fb129c35dd6b306b`.
Native UI acceptance failed after seven of nine complete geometry cases and
40 of 45 required Hide-control hit checks. At 800×720 outer size and 125%
native zoom, a wrapped notice left less than one complete terminal row. The
rendered screen extended 1.6 CSS pixels below the dock. The existing containment
tolerance was retained; this candidate was not tagged or published.

Four full attempts and four diagnostics were preserved. Two earlier test
assumptions were corrected separately: an isolated short PowerShell prompt
keeps executed output visible, and `offsetWidth` measures the existing 380-pixel
stage allocation including its scrollbar. Exact output checks, width thresholds,
control hits, dirty drafts and shell continuity remain required. The later
terminal clipping is a product defect, not another tolerance adjustment.
See the [candidate summary](qa/windows-candidate-3984b7f/summary.json),
[attempts](qa/windows-candidate-3984b7f/all-attempts-summary.json),
[containment measurements](qa/windows-candidate-3984b7f/terminal-containment-diagnostic-status.json)
and [cleanup](qa/windows-candidate-3984b7f/final-owned-cleanup-status.json).
The corrected candidate requires fresh installer provenance and a new complete
native run. No 2.4.1 public-release, endurance or real-model pass is implied.

## 2.4.0 public release — November 12, 2026 UTC

All nine platform installers are published from immutable commit
`25c8345f99f246b37ea45bf9306eb551da9c0819`. All 23 public files passed
[downloaded-byte verification](qa/platform-release-2.4.0/public-assets-verification.json).
Both Linux targets passed the 15 required release gates, including real native
window/endurance checks and offline clean-host package installation. The public
Linux payloads authenticated against the tracked Ed25519 key, and the live APT
repository passed independent signature/index/package verification. See the
[publication procedure](RELEASING.md) and [APT proof](qa/platform-release-2.4.0/apt-public-verification.json).
These CI and download checks do not replace physical-machine acceptance.

**Windows laptop qualification did not pass overall.** The exact public installer
SHA-256 `a9d459d482b4509109566e888d281373ef4a68b40c9613b614a107300b09f986`
installed and passed clean-PATH runtime checks on Windows 11 Home x64, Ryzen 3
5300U, 32 GB RAM. The installed executable SHA-256 is
`ff6e1cb61232c57d70e639056ecd7fc0de3f90295d546bd3655d0e8a4672cab2`.
Onboarding, project task creation, editor find/replace/undo/redo/save, dirty-file
preservation and terminal focus checks passed before the layout failure.

At a 1160×720 native window and 175% native WebView zoom (654×389 CSS pixels),
the composer overflowed its stage by 84.571 pixels. Its content intercepted the
terminal Hide control's center and all four inset corners. This is a product
layout defect under investigation for **2.4.1**, not a passed native UI run.
An earlier editor-line failure at 125% was a probe assumption: ordinary drawer
scrolling made the line visible and focusable. Failed and diagnostic attempts
are retained; completing a measurement does not count as acceptance.

The installed engine separately passed 100 sequential and 80 concurrent tasks,
five cancellations and persistence after forced termination using a scripted
provider. The real Gemma task was interrupted for patch work and remains
**incomplete**; no real-model pass is claimed for 2.4.0. Owned qualification
processes and tasks were cleaned up. Evidence:
[installation](qa/platform-release-2.4.0/windows-installation.json),
[endurance](qa/platform-release-2.4.0/windows-endurance.json),
[artifact binding](qa/platform-release-2.4.0/windows-endurance-artifact.json),
[geometry measurement](qa/platform-release-2.4.0/windows-geometry-measurement.json),
and [final checkpoint](qa/platform-release-2.4.0/windows-checkpoint.json).

The macOS workflow passed bundled-app/runtime smoke tests and disk-image
verification for Apple Silicon and Intel. It uses ad-hoc signing, not Developer
ID signing or notarization. Flatpak install/start probes passed on x86_64 and
ARM64. No new physical iMac, native Mac accessibility or Omarchy 2.4.0 acceptance
is implied; older machine records below remain tied to their original versions.


## 2.3.3 public release — November 2, 2026

Linux 2.3.3 is published. The Windows, macOS and Flatpak packages are also published.

On the Omarchy x64 laptop, the publisher-authenticated public AppImage was installed with the independently reviewed 2.3.3 trust bundle. The installed AppImage SHA-256 is `4d7b49048718bc7a25407362958ea63b7d5d69a66f23afc8a287274be3245747`; the extracted native binary is `6b47514c3028cc4e3e98d7bd2fa46f73a437d5883dd8551278d3b0e4da3d04f7`. The installer required and observed the first native window.

A focused test on the laptop's actual Wayland compositor passed 12 interface checks, including onboarding, provider discovery (including Grok), accessibility, a scripted-provider task with approved file writing and command execution, and clean app shutdown. It excludes the floating-window sizing and resize tests, recovery and the full UI endurance suite. Separately, the extracted installed engine passed 100 sequential and 80 concurrent tasks, five cancellations and persistence after a graceful stop. That probe uses a loopback scripted provider: it does not demonstrate real-model inference or inference-server memory behavior. The [installation receipt](qa/platform-release-2.3.3/omarchy-installation.json), [Wayland interface results](qa/platform-release-2.3.3/omarchy-native-wayland.json), and [endurance results](qa/platform-release-2.3.3/omarchy-endurance.json) retain the hashes and measurements. The raw Wayland receipt retains a stale scope sentence saying Grok was excluded; its recorded configuration and picker check show that the Grok row was present in this run. The receipt is kept unchanged. This does not qualify a live Grok login or model task.

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
