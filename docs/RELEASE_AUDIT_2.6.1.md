# ShadowCode 2.6.1 release audit

## Product assessment

**77/100 for a developer who wants a local-first AI coding workspace.** This editorial score weights five areas equally. Coding reliability draws on the paired runs below. The other ratings reflect the audited source, test results and distribution process.

| Area | Points | What earned and cost points |
|---|---:|---|
| Local models and provider choice | 18/20 | Supports local GGUF models, an OpenAI-compatible server and vendor agents. Model memory estimates still require judgment on the target machine. |
| Editing, review and user control | 17/20 | Job-specific approvals, change review, checkpoints and a verification history give users a way to examine agent work. Read-only behavior depends on vendor capabilities. |
| Coding reliability | 12/20 | The last paired round passed two of three external acceptance checks. One earlier correct edit ended with an error. The failed diagnosis returned exit code zero in both final rounds. |
| Engineering and dependency health | 17/20 | Unit, browser and protocol tests exercise distinct failure modes. Both npm audits are clean. Eleven native packages still have maintenance notices. |
| Desktop distribution | 13/20 | Linux has package and repository signatures. The release candidate adds GitHub build attestations for each platform. Direct macOS and Windows distribution still lacks verified platform publisher credentials. |

**Compared with Aider**, ShadowCode combines model setup, task approvals, file review and verification in its desktop UI. Aider's terminal workflow supports automatic linting and configurable test runs after edits. It solved the failing-test diagnosis in each of our four rounds. [Aider lint and test documentation](https://aider.chat/docs/usage/lint-test.html)

**Compared with VS Code's agent workflow**, both offer approvals, worktrees and change review. VS Code also documents remote and cloud sessions and a large extension ecosystem. ShadowCode's case for a local-first user is the bundled GGUF runtime and the ability to work with several agents in one desktop workspace. This is a documented feature comparison. We did not run VS Code through the paired fixtures. [VS Code agent documentation](https://code.visualstudio.com/docs/agents/overview)

## Dependency findings

On November 26, 2026, the full UI npm audit and the independent MCP peer test project each returned zero advisories. The second project initially had nine flagged package entries and was outside the original UI audit.

OSV queries covered every registry package and exact version in both native lockfiles (the 2.6.0 and 2.6.1 revisions of Cargo.lock). The original scan matched 22 package versions. After updating SQLite, MCP, TLS, certificate roots, Tokio, Rustix, Cookie, URL and QUIC dependencies, all remaining matches were maintenance notices with no fixed version listed. The following chains explain why the packages remain.

| Remaining maintenance notices | Dependency path and disposition |
|---|---|
| chrono | Local wall-clock schedules and the MCP SDK. Preserve schedule semantics while upstream support evolves. |
| unsafe-libyaml | Used by serde_yaml_ng for existing YAML configuration and imports. A replacement requires compatibility tests against stored profiles. |
| proc-macro-error | Linux GLib 0.18 build macros in the GTK desktop stack. Migrating the stack involves its WebKit ABI. |
| unic-char-property, unic-char-range, unic-common, unic-ucd-ident, unic-ucd-version | Unicode tables and identifier processing under urlpattern in Tauri utilities. Track the Tauri dependency upgrade. |
| zvariant, zvariant_derive, zbus_names | D-Bus serialization and names under zbus, used for Linux desktop integration. Track the compatible zbus transition. |

## Application and packaging fixes

- A task-specific approval marks only its active job. A session-only signal with several plausible jobs gets a single session row. The tab badge counts the rows it exposes.
- Cursor and Grok read-only tasks require plan-mode acknowledgement before their prompt is sent. Test cases exercise absent, rejected and acknowledged mode changes.
- The Windows updater recognizes the NSIS package and names the correct setup executable. Custom Cargo target directories are recognized as source builds.
- The Windows build checks the pinned Vulkan SDK digest and requires the dynamic GPU module alongside CPU backends. Mac and Windows packaging collect the host Cargo graph and production JavaScript dependency notices.
- The real-model runs exposed an empty turn and a promise to read a file. The engine retries one empty turn within its existing limits and detects the observed unfinished-work phrasing. Full file-read schemas now specify valid numeric ranges and defaults. Small-context models get the compact 1-based form, which preserves the tested 4,096-token route. The tool validates ranges before recording an observation.

## Matched coding outcomes

Both clients ran on the same Apple silicon Mac against the same Pop!_OS inference server (Ollama 0.34.0, RTX 5060 Ti, driver 595.104.02). The model was Qwen3-4B-Instruct-2507 Q6_K, Ollama digest `cc13fd386d72bc063b934c809d6f292e7313086cb6d97106c70ffdafc65bec66`. Each paired run started from identical Git fixtures and instructions. The runner checked behavior separately after each process exited, including preservation of the original diagnosis test. No reviewer correction or paid provider call occurred. The times include client startup. Local hardware and energy costs were not measured.

ShadowCode used its native tools with approved actions in disposable fixture repositories. Aider 0.86.2 used whole-file edits with the small fixture files supplied and repository mapping disabled. An earlier Aider setup failed during SciPy loading before inference. Four completed paired rounds are reported below. Model sampling was unseeded. This is three tasks per round, with different client prompts and tool protocols.

| Round | Task | ShadowCode acceptance / seconds / exit | Aider acceptance / seconds / exit |
|---|---|---|---|
| Before engine fixes | bug-fix | Fail / 5.22 / 1 | Pass / 4.60 / 0 |
| Before engine fixes | multi-file | Pass / 9.78 / 0 | Fail / 5.89 / 0 |
| Before engine fixes | test-diagnosis | Fail / 4.91 / 1 | Pass / 6.37 / 0 |
| Empty-turn retry | bug-fix | Fail / 8.58 / 1 | Pass / 4.19 / 0 |
| Empty-turn retry | multi-file | Pass / 9.25 / 0 | Pass / 3.37 / 0 |
| Empty-turn retry | test-diagnosis | Fail / 3.99 / 0 | Pass / 8.73 / 0 |
| After read-range and completion fixes | bug-fix | Pass / 10.34 / 1 | Pass / 8.12 / 0 |
| After read-range and completion fixes | multi-file | Pass / 11.40 / 0 | Fail / 9.99 / 0 |
| After read-range and completion fixes | test-diagnosis | Fail / 11.17 / 0 | Pass / 6.98 / 0 |
| After restoring tiered tool descriptions | bug-fix | Pass / 5.82 / 0 | Pass / 4.87 / 0 |
| After restoring tiered tool descriptions | multi-file | Pass / 12.86 / 0 | Fail / 5.70 / 0 |
| After restoring tiered tool descriptions | test-diagnosis | Fail / 10.55 / 0 | Pass / 7.72 / 0 |

In the third round (source fbeaa9f) both products passed two of three acceptance checks. ShadowCode fixed the percentage helper but then exited with an empty model reply. Its diagnosis task left the original function untouched and the verification record correctly showed that no check had run. Aider missed the required unknown-unit behavior on the multi-file task. The fourth round (source 26f66e5) reproduced the same acceptance outcomes, and the correct percentage fix exited successfully. The diagnosis response asserted that the code passed the test despite the missing check. The verification classifier now labels the two observed assertions as unverified when no passing receipt exists. The results do not establish general model quality.

Reproduce with [the fixture runner](../scripts/qualification/coding-outcomes.py), an isolated output directory, a local OpenAI-compatible model endpoint and both client executables. Run the script with `--help` for arguments.
