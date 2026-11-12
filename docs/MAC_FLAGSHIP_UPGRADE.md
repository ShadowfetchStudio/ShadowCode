# Apple silicon workspace upgrade — implementation and qualification

This document records the November 11, 2026 development qualification. Its tests
and captures retain their original scope; publication does not convert them into
installed-app acceptance evidence.

The implementation was subsequently published in the [2.4.0 source and release](https://github.com/ShadowfetchStudio/ShadowCode/releases/tag/v2.4.0),
at `25c8345f99f246b37ea45bf9306eb551da9c0819`. See the
[release procedure and publication record](RELEASING.md) and
[platform qualification](PLATFORM_QUALIFICATION.md) for later package evidence.
Baseline: `82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0` (2.4.0), branch
`cursor/apple-silicon-t3-ux-610c`.

## Design decision and research

The upgrade organizes ShadowCode around the working project, its conversation,
its files and the evidence for its changes. It builds on the existing engine,
editor, review and terminal rather than introducing a second execution/state
system. The side panel can now be sized to the work; a bottom terminal allows
file, conversation and command output to remain visible together.

The [research synthesis](../reports/ShadowCode%20Mac%20flagship%20upgrade.md)
combines three source-linked studies:

- [Mac interaction and accessibility](../research_notes/ShadowCode%20Mac%20flagship%20upgrade/mac-interaction.md).
- [Workspace product structure](../research_notes/ShadowCode%20Mac%20flagship%20upgrade/workspace-product.md).
- [Apple silicon runtime and memory](../research_notes/ShadowCode%20Mac%20flagship%20upgrade/silicon-runtime.md).

Apple's interaction guidance and editor documentation inform the design. Code
inspection establishes the specific defects. Proposed usability targets and
future experiments in the study are not measured product improvements. In
particular, this upgrade makes no percentage speed claim or claim that MLX is
better than the existing Metal runtime.

## Implemented workspace structure

| Area | Change | Ownership and preservation contract |
| --- | --- | --- |
| Workspace chrome | Direct Files, Terminal and Preview actions; selected state; more legible welcome cards | Existing panel implementations and existing starter prompts; cards only fill the composer |
| Panel sizing | Pointer/keyboard separator, persisted preferred width, responsive clamp, reset | The separator owns only the panel-width preference; it must leave the conversation usable |
| Project context | Folder and branch remain visible; direct task-review and project-check access | Existing `useRunCheck` approval/scope validation and review target; completion does not imply verification |
| Terminal dock | Optional terminal below file and conversation surfaces | Same engine shell and remembered selection; one mounted view; hiding a view does not kill its shell |
| Project creation | New task per project; parent paths for ambiguous names | Creation joins the session activation queue; delayed replies cannot override a later selection |
| Mac shortcuts | Command-Shift-M for models; Control-backtick for Terminal; platform-correct hints | Leave Command-M/Command-backtick to native window behavior; preserve IME and Option-arrow editing |
| Motion preference | Terminal cursor observes reduced-motion changes while mounted | No shell restart or new terminal required |
| Review freshness | Review marks tied to content revisions | Being reviewed is separate from staged/committed; stale marks cannot exempt changed content from review |

The review found terminal clipping, compact overlay overlap, command-routing
and failed-cancellation reconciliation defects in the first implementation.
See [the final integration review](../reports/final-integration-review.md),
[its implementation resolution](../reports/final-integration-resolution.md),
[review freshness audit](../reports/review-freshness-audit.md), and
[the initial review and resolution record](../reports/mac-ui-review.md) and
[model cancellation fix](../reports/model-cancellation-fix.md). A test passing
before these findings did not establish that the dock or cancellation lifecycle
was correct; regression coverage now targets the actual failure sequences.

## Apple silicon runtime

The [runtime change record](../reports/silicon-fixes.md) describes the exact
implementation and tests. The changes:

1. Do not add speculative pages twice when estimating reclaimable Mac RAM.
2. Check fresh shared-memory headroom before a new allocation, including CPU
   fallback on positively identified Apple Metal hardware. Retain a 2 GiB
   reserve. Unknown/inconsistent telemetry does not refuse a model.
3. For the audited llama.cpp revision, disable the additional host prompt cache
   (`--cache-ram 0`) on identified Apple shared memory. Active KV is unchanged;
   the estimate does not account for every transient/checkpoint allocation.
4. Observe cancellation during readiness/metadata requests and at the loaded
   model publication boundary; terminate the owned child and preserve retry.
5. Expose manual load cancellation and reconcile a load that continues after
   cancellation is rejected. Show sampled memory, requested backend and CPU
   fallback without claiming observed GPU execution from device detection.

The memory gate is advisory, not an OS memory-pressure event or reservation.
Disabling repeat-prompt cache can affect latency; it is not a demonstrated
performance improvement. Unrecognized runtime revisions retain their arguments.

## Verification ledger

This section records observed results and pending gates separately. Logs are
local working artifacts; meaningful test sources and the reports are retained
with the change.

| Evidence | Observed result / scope |
| --- | --- |
| Baseline UI units | 877 passed in 156 files |
| Current UI units | 906 passed in 157 files on the final implementation snapshot |
| Mac shortcut regressions | Preserve native window combinations, platform hints, text-field ownership and IME |
| Targeted native local units | 60 passed, 3 ignored; unrelated tests filtered |
| Full native core units | 677 passed, 8 ignored after correcting the external-temp sandbox issue |
| Native review/API integration | 9 passed across api_contract and composer_review |
| Native local-engine integration | 33 passed, 3 ignored; fake-server cancellation and fallback |
| ARM64 desktop/CLI build | Debug Mach-O arm64, version 2.4.0; isolated status/health/SQLite smoke checks passed |
| Browser interaction | 154/154 full Chromium tests and 35/35 focused WebKit tests passed on the frozen final implementation |
| Real local-model lifecycle | Passed load, real completion, process reuse, unload, reload and cleanup; intentional failure also cleaned up |
| Clippy | Passed workspace/all-targets with warnings denied; corrected a Mac C-string literal lint in Rosetta detection |
| Production bundle isolation | Passed: no test transport or fake backend in production output |
| Native desktop interaction | Not exercised by computer-use tools in this session; tool capability is unavailable |

Native build/cache/model artifacts are on the external NVMe:
`/Volumes/NVME1TB/Development/ShadowCode-build`. The model download was pinned to
`Qwen/Qwen3-0.6B-GGUF` revision `23749fefcc72300e3a2ad315e1317431b06b590a`,
639,446,688 bytes, SHA-256
`9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031`, matching the
publisher's LFS object hash. It is an Apache-2.0 integration fixture, not a
recommendation of coding quality. No cloud model or paid provider is needed.

## Additional Mac defect found through qualification

The full native test run exposed missing metadata access to Darwin's per-user
temp directory when workspace and scratch were on an external drive. Apple
compiler/Git shims could not use their specifically allowed `xcrun_db` files.
The fix grants metadata access to that directory alone. A real Seatbelt
regression proves that compiler tools work and unrelated sibling files remain
unreadable and unwritable. See [the diagnosis and regression evidence](../reports/mac-sandbox-fix.md).

The built development app passed deep/strict ad-hoc signature verification and
executed two Python fixture tests through its own CLI with an isolated profile.
It is ARM64 and bundles the pinned Metal runtime. The app was rebuilt after
the final palette-focus change; the packaged executable again passed signature,
status, doctor and the two Python fixture tests. Its SHA-256 is
`c47771bd4b3591bf6359d88c72169955987247352e34163e33ce3eaae1b45e6f`.
The doctor deliberately did not contact a model in this isolated offline
profile; the real-model lifecycle is separate evidence.

## Delivery and qualification limits

The delayed-focus, CSS-zoom, palette-focus and terminal-state findings are
resolved, with regressions passing on the frozen implementation. The final
Chromium and WebKit suites, real-model lifecycle, production isolation, full
native units and packaged ARM64 build have passed within the recorded scopes.
The [delivery audit](../reports/flagship-completion-audit.md) maps the objective
to evidence; [the qualification manifest](../reports/qualification-results.json)
records source, executable, log and screenshot hashes.

Browser automation uses a deterministic engine and can test races, rendering,
focus and input ownership. Native CLI/model probes exercise the real engine.
Neither establishes installed WKWebView menu arbitration, VoiceOver behavior,
non-US physical keyboard behavior or a developer usability study. Those require
separate native/human qualification. The development app is ad-hoc signed. Developer ID signing, notarization, a
distribution installer, release publication and website deployment were not
part of that November 11 local qualification. Later publication evidence is
recorded separately in the linked release and platform records; native
VoiceOver, physical-keyboard acceptance and notarization are not established by
the tests in this document.

Future research proposals include a larger execution-history surface, an
opt-in guided first task, OS pressure-event policy, and controlled MLX/cache
comparisons. These are hypotheses for later evaluation, not hidden features
claimed complete by the current implementation.

## Files to open

- Development app: `/Volumes/NVME1TB/Development/ShadowCode-build/debug/bundle/macos/ShadowCode.app` (approximately 201 MiB on disk).
- Isolated review launcher: `/Volumes/NVME1TB/Development/ShadowCode-build/silicon-validation/desktop-review/Open ShadowCode Review.command`. It opens the development app with a disposable repository and separate profile; choose a model there to try coding. It has not been launched through native computer-use in this session.
- Real-model qualification receipts: `/Volumes/NVME1TB/Development/ShadowCode-build/silicon-validation/`.
- Final interface captures: `reports/visuals/final-chromium/`; these are browser test-fixture captures, not native-window screenshots.

At the end of the November 11 development qualification, the sources were local
working-tree changes on the named branch. They were subsequently committed and
pushed, and the 2.4.0 release was published as linked above. The original
development artifacts and browser-fixture provenance remain unchanged.
