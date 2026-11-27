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

## Comparison and opportunities

**Aider** integrates automatic linting after edits and supports a configured test command. ShadowCode already tracks whether a configured check still applies to the current files. Making that verdict visible beside the task outcome gives the user a reason to trust it or rerun the check. A next experiment is to measure time from a clean checkout to the first passing project check. [Aider linting and testing](https://aider.chat/docs/usage/lint-test.html)

**Cline** puts compare and restore controls at individual checkpoints and documents their storage cost. ShadowCode has file review, receipts and rewind. A useful comparison would give first-time users the same failed edit and measure whether they can identify the affected files and restore their work while preserving unrelated edits. [Cline checkpoints](https://docs.cline.bot/core-workflows/checkpoints)

**Cursor** emphasizes reviewing live diffs and reviewing a whole branch before merging. In ShadowCode, the Git drawer can hand a branch to the correct forge even when a supported native CLI is unavailable. A remaining workflow opportunity is to test how readily users discover that browser action with a real Codeberg or Azure project. [Cursor reviewing and testing](https://cursor.com/learn/reviewing-testing)

The strongest distribution opportunity is operating-system publisher trust. The current studio key and GitHub attestations support release verification. Apple Developer ID and notarization, and a Windows Authenticode identity, require their respective credentials. The current release process can operate from one authorized GitHub account without copying a studio private key to each build machine.

