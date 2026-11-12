# Apple Silicon upgrade: delivery audit

Objective: research concrete improvements to ShadowCode for Apple Silicon Macs,
and implement a substantial upgrade to its structure and UI. Baseline
`82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0`; local branch
`cursor/apple-silicon-t3-ux-610c`.

This audit evaluates the actual request. Research recommendations are retained
as recommendations: the proposed ten-developer study, multi-machine benchmark,
MLX comparison, OS pressure-event policy and guided first task were not user
requirements or silently claimed implementations. No performance percentage,
full accessibility certification or distribution-release claim is made.

| Requirement | Authoritative evidence | Current assessment |
| --- | --- | --- |
| Deep research specific to the project | Three source-linked notes in `research_notes/ShadowCode Mac flagship upgrade/`, synthesis in `reports/ShadowCode Mac flagship upgrade.md`, immutable baseline source links and pinned runtime analysis | Delivered: platform conventions, competitive workflow patterns, state ownership, memory/cancellation analysis and prioritized proposals, with evidence limits |
| Upgrade workspace structure | `App.tsx`, `WorkspaceContextBar.tsx`, `PanelResizeHandle.tsx`, `useNavigation.ts`, Sidebar and existing drawer-memory integration | Implemented: direct tools, persistent project/check/review context, project-scoped creation, resizable file pane and optional bottom terminal |
| Upgrade visual and interaction design | `flagship.css`, welcome cards, toolbar states, effective zoom layout and focus ownership; current Chromium captures in `reports/visuals/final-chromium/` | Implemented; full Chromium 154/154 and focused WebKit 35/35 passed |
| Preserve user work and input ownership | Flagship/parallel/tool regressions use real CodeMirror/xterm with deterministic service responses; late focus and session activation cases, dirty file/composer checks, same-shell assertions | Final browser suites passed; no claim that browser fixtures establish native menu/VoiceOver behavior |
| Make Mac interactions coherent | Platform shortcut tests, `useTerminalFocus`, palette close ordering, live reduced-motion cursor handling | Implemented; final WebKit 35/35 passed |
| Correct Apple shared-memory and model lifecycle defects found by research | Native source and runtime unit/integration results, real pinned Qwen GGUF lifecycle and injected-failure cleanup receipts | Passed bounded native qualification; no observed-layer-offload, large-model, or speed/quality claim |
| Keep review markers attached to current content | Summary/detail snapshot hashes, revision-keyed marks, async ownership guards, failed/no-op undo detail recovery | 26 focused review tests and 906 full UI tests passed; native review/API integration 9 passed |
| Deliver a usable native build and updated documentation | Final ARM64 bundle, strict/deep signature verification, packaged doctor and two Python checks; updated architecture, user guide, local-model guide, changelog and implementation companion | Packaged local development app passed; app-window interaction and release qualification remain separately untested |

## Evidence boundaries

The packaged app is a debug ARM64 development candidate with ad-hoc signing,
not a notarized installer. It is external to Applications and has a launcher
using a disposable project and separate profile. That profile deliberately has
no coding model configured. The real-model test used its own short-lived profile.
No user's default project, model choice or app installation was replaced.

The native GUI capability is unavailable in this session. WebKit browser
interaction and real native engine/CLI qualification provide different evidence;
neither is represented as a native window/VoiceOver acceptance run. Developer ID
signing, notarization, public release and website deployment are separate release
work. This delivery does not publish to GitHub or the website.

Final test counts, source hashes, executable hash and evidence file hashes are
recorded in `reports/qualification-results.json`. All active qualification runs
finished successfully. The reviewed findings are resolved. The requested
research and local structural/UI upgrade are delivered; the explicitly listed
native-human and release qualifications remain outside the claims of this
development delivery.
