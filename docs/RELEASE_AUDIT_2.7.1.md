# ShadowCode desktop product audit

Reviewed November 27, 2026. The public baseline was 2.7.0. The findings below informed 2.7.1. The score evaluates the baseline, so proposed changes earn no credit until users can install them.

| Area | Points | Evidence and judgment |
|---|---:|---|
| Model choice and local operation | 18/20 | The bundled local runtime and shared model picker let a developer use their hardware and vendor accounts in one workspace. Vendor tools differ in the permissions and usage data they expose. |
| Review and verification | 17/20 | Configured checks have command receipts and workspace freshness tracking. Finding the current verdict required looking below the changed-file list. |
| Desktop and remote interaction | 15/20 | Quick Open, Markdown preview and Mission Control cover common tasks. On a 390-pixel viewport the send control measured 31 by 31 pixels and the two approval buttons were only 21 pixels high. |
| Installation and release integrity | 14/20 | Linux has studio signatures and APT signing. All nine installers have provenance. The 2.7.0 release became public before all platform downloads arrived, and its documented cask command failed on Homebrew 7. macOS notarization and Windows Authenticode remain separate distribution gaps. |
| Reliability and privacy | 15/20 | Regression coverage spans native code, browser UI and packaging. Unclosed model channels could expose draft content, and a token in an HTTP remote's query string could enter displayed repository metadata. |
| **Total** | **79/100** | A desktop developer who regularly switches between a local model and a subscription benefits most. This is an engineering judgment based on the reviewed workflows. Coding accuracy, latency and memory consumption require matched workloads and models. |

## What changed in the patch

| User-visible failure | Correction and regression check |
|---|---|
| Draft model text appeared while a channel was still open | Streaming-prefix tests exercise split tags, nested tags, truncated replies and ordinary prose. Reviews, Git suggestions and repeat warnings use filtered text. |
| A release was visible while some platform downloads returned 404 | The publisher validates both signed Linux bundles, checks provenance for nine installers and reads back 27 asset digests before publishing. Fixtures cover missing and changed installers, missing provenance, interrupted uploads and retry. |
| Homebrew could not install the documented path | The repository exposes a standard cask tap. The publisher derives version-specific Homebrew and WinGet files from qualified bytes. |
| Azure SSH remotes produced an unusable browser link | SCP-style and URI-style Azure remotes resolve to the same compare page as HTTPS. Remote display data drops HTTP query strings and fragments. |
| Phone send and approval controls were hard to tap | Browser coverage measures both dimensions of the rendered controls at 320, 390 and 600 pixels. Composer checks also look for overlaps. |
| An unrelated, unreadable process could fail Linux qualification | The X11 test uses a separate POSIX session. The harness can recognize another pre-existing session, verifies process identity and retains refusal for ambiguous processes. |
| A failed Mac update could strand the previous app, while Windows local installation could choose the wrong version | A Mac fixture fails the final move and checks restoration plus preservation of neighboring files. Windows checks ambiguous local input before opening an installer. |

A clean Windows runner also exposed a packaging timeout. The notice generator stopped Cargo after two minutes while it was downloading locked sources. The patch gives this operation ten minutes and continues to require the complete resolved dependency list and notice archive.

Linux qualification found stale Alpine builder pins for libffi on both targets and libxml2 on ARM64. The runtime recipe pins each available version exactly, and native CI now checks both official package indexes before compiling. The musl upstream timed out on the ARM builder. The runtime now accepts Alpine’s distribution copy only when it matches the existing SHA-512, and both jobs build the pinned runtime early.

## Comparison and opportunities

**Aider** integrates automatic linting after edits and supports a configured test command. ShadowCode already tracks whether a configured check still applies to the current files. Making that verdict visible beside the task outcome gives the user a reason to trust it or rerun the check. A next experiment is to measure time from a clean checkout to the first passing project check. [Aider linting and testing](https://aider.chat/docs/usage/lint-test.html)

**Cline** puts compare and restore controls at individual checkpoints and documents their storage cost. ShadowCode has file review, receipts and rewind. A useful comparison would give first-time users the same failed edit and measure whether they can identify the affected files and restore their work while preserving unrelated edits. [Cline checkpoints](https://docs.cline.bot/core-workflows/checkpoints)

**Cursor** emphasizes reviewing live diffs and reviewing a whole branch before merging. In ShadowCode, the Git drawer can hand a branch to the correct forge even when a supported native CLI is unavailable. A remaining workflow opportunity is to test how readily users discover that browser action with a real Codeberg or Azure project. [Cursor reviewing and testing](https://cursor.com/learn/reviewing-testing)

The strongest distribution opportunity is operating-system publisher trust. The current studio key and GitHub attestations support release verification. Apple Developer ID and notarization, and a Windows Authenticode identity, require their respective credentials. The current release process can operate from one authorized GitHub account without copying a studio private key to each build machine.


## Project links

The project website linked from GitHub, the app and its package listings redirected to CompatWiki, a hardware compatibility catalog. The project overview now points to the repository README, and the download link points to the latest GitHub release. A check across 74 Markdown files found no missing relative file targets or unresolved heading links in the links examined. The publisher’s separate downloads page still listed 2.4.1 when reviewed. [Publisher downloads](https://www.shadowfetch.com/downloads#shadowcode)

## Dependency maintenance

On November 27, 2026, npm reported zero advisories for the locked UI dependency tree. An OSV query for all 663 registry package/version entries in the Rust lockfile returned 11 unmaintained-crate notices. Source and path dependencies, including the vendored GLib backport, fall outside that registry query. A clean package scan alone cannot establish application security.

The project controls two useful starting points. Its YAML configuration uses `serde_yaml_ng`, which brings in unmaintained `unsafe-libyaml`. A parser migration should test saved configurations, old profiles and round-trip output. The native core also uses the D-Bus 5.x stack alongside Tauri and notification plugins. Moving the core alone would leave the older wire-format dependencies in the package. Coordinate the migration with the desktop plugins. [RustSec YAML advisory](https://rustsec.org/advisories/RUSTSEC-2024-0449.html) · [RustSec D-Bus migration](https://rustsec.org/advisories/RUSTSEC-2026-0370.html)

The remaining notices concern Chrono, a procedural-macro helper and the UNIC Unicode crates. The audit found Dependabot alerts and automated security updates disabled. Both settings were enabled on November 27 and verified through the GitHub API. The initial open-alert list was empty. Secret scanning and push protection were already enabled. [RustSec Chrono advisory](https://rustsec.org/advisories/RUSTSEC-2026-0543.html)

## Published release verification

GitHub published [2.7.1](https://github.com/ShadowfetchStudio/ShadowCode/releases/tag/v2.7.1) at 2026-11-27T22:46:53Z from `f42063df307c81d2e3fa03daea46062379512680`. The [release workflow](https://github.com/ShadowfetchStudio/ShadowCode/actions/runs/46070735729) completed. Independent readback matched all 27 release asset digests and checked GitHub provenance on all nine installers. Both Linux studio signatures and both APT architectures were verified. The Homebrew and WinGet pins match the public installer bytes. A fresh Homebrew 7 checkout exposed a missing cask trust step in the installation guide. After trusting the ShadowCode cask in a disposable configuration, Homebrew fetched both public DMGs and their SHA-256 digests matched GitHub. WinGet on the Windows laptop validated the published manifests.

The Apple Silicon and Intel disk images were mounted and checked. The Intel iMac ran the packaged command, Pop!_OS executed the x86_64 AppImage and Flatpak, and the Windows laptop ran the application extracted from the public NSIS installer. The hosted Windows workflow separately exercised installation.

## Score after publication

Using the same five equally weighted criteria, the verified 2.7.1 release scores **86/100**, up from **79/100** for 2.7.0.

| Area | 2.7.0 | 2.7.1 | Evidence for the change |
|---|---:|---:|---|
| Model choice and local operation | 18 | 18 | This patch preserves the existing model choices. |
| Review and verification | 17 | 18 | The task outcome now shows whether its check still applies to the current workspace. |
| Desktop and remote interaction | 15 | 16 | Browser tests measured the send and approval controls on three phone widths. |
| Installation and release integrity | 14 | 17 | All nine installers passed provenance verification, package-manager pins matched their bytes, and the macOS rollback fixture preserved the previous app. Apple notarization and Windows Authenticode remain outstanding. |
| Reliability and privacy | 15 | 17 | Regression tests cover incomplete reasoning channels and token-bearing remote URLs. Dependency alerts and automated security fixes are enabled. |

These scores reflect engineering review of the tested workflows. The comparison includes no head-to-head coding accuracy, latency or first-time-user benchmark.

The Apple Silicon DMG ran Qwen3-0.6B-Q8_0.gguf on Metal. The runtime offloaded 1/29 layers to GPU and generated 4 tokens. The Windows installer runtime ran gemma-4-E4B_q4_0-it.gguf through Vulkan and generated 4 tokens. These short generations verified hardware execution.

## Remote UI performance opportunity

The production build for the reviewed PR has 5 JavaScript and CSS files in its initial static import graph, totaling 1,037,591 bytes. Compressing each file independently with gzip produced 312,710 bytes. The Markdown bundle accounts for 62,378 of those compressed bytes. Measure time to the first usable approval on a phone over a cold remote connection before deciding whether to defer Markdown rendering. These build sizes exclude icons, dynamic imports and API traffic. Actual transfer and interaction time depend on the serving path, connection and cache. Six focused WebKit browser cases passed across About, model-specific composer layouts and phone approval targets.
