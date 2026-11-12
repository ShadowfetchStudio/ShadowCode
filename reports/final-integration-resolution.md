# Final integration resolution and qualification boundary

November 11, 2026. Report-only completion after source freeze. This follows [final-integration-review.md](final-integration-review.md) findings 1–3 and [review-freshness-audit.md](review-freshness-audit.md). No release or commit was performed.

## Frozen source and final edit

**App.tsx is frozen at SHA-256 `9cce6b278a1b242655179658c04f1a853401bee5a9b6b7c957599d2d23164837`.** Its filesystem modification time is **2026-11-11 19:44:26 EST (UTC−05:00)**. Main independently confirmed the same hash. No code/test edits, builds, or browser runs are authorized for this contributor after freeze; main owns final qualification.

The last edit was functional: import `flushSync` from `react-dom`, and replace the palette's direct `panel: setPanel` callback with a wrapper that, for Terminal, commits `setOverlay("")` before calling `setPanel(next)`. This lets the palette dialog finish restoring focus before a new terminal focus intent is created. Prettier subsequently reported App.tsx unchanged. The last `flagship.spec.ts` and `macInteraction.spec.ts` modifications were at 19:43:10 EST.

**Evidence boundary:** the 68/68 browser pass below predates that 19:44:26 functional edit. It is not a passing qualification of the final App snapshot. Main reports its test bundle was built at **19:44:37** and production app at **19:44:52**, both after the edit; these timestamps are coordinator-reported, not independently established here. At this report's handoff, main's final full Chromium run and final unit rerun are **pending**, with targeted WebKit planned afterward. The earlier main 906/906 unit/typecheck report does not replace those final checks.

## Finding 1 — explicit terminal focus ownership implemented

- Added `useTerminalFocus`: an outstanding request belongs to a workspace and is consumed when a connected terminal input becomes ready. A subsequent pointer/focus choice outside the terminal cancels it. No event timeout grants ownership.
- App requests focus for intentional Terminal commands and placement changes. TerminalPanel requests it for explicit tab/new/restart actions. TerminalView now reports readiness instead of unconditionally focusing at mount.
- Workspace changes cancel pending ownership. A list response, lazy mount, or workspace rekey therefore does not independently authorize shell focus.
- Existing dock command routing retains dirty Files, reuses a single shell, and retains Hide focus restoration. General drawer closing behavior remains in place. TerminalView's runtime reduced-motion subscription and terminal CSS-zoom compensation are preserved.
- Held-list negative tests choose and type in the editor/composer before resolving the terminal list, then verify continued focus, intact text, zero terminal-input requests, and one shell. A held-list positive case verifies an unrevoked request still focuses on readiness. Another test checks a visible dock's workspace remount.

**Late integration correction:** a focused palette test reproduced a real interaction in both browsers: dialog cleanup restored the composer and canceled the new request. The final synchronous palette-close change described above addresses that control-flow cause. Its runtime pass is deferred to main's final qualification. The negative held-list safeguards are not removed or replaced by this correction.

## Finding 2 — effective-width shell layout implemented

`useWorkspaceLayout` computes effective width as `window.innerWidth / cssZoom()`. App uses its compact state for navigation behavior; the same hook supplies classes that select shell grid/sidebar/drawer/tool-label CSS. Native webview zoom continues to supply its own layout width with `cssZoom() === 1`; there is no second division by the saved application zoom and no change to the native zoom API.

At effective widths ≤1150 the open tool pane collapses the sidebar; at ≤760 the pane becomes an overlay. Split tracks cap the tool pane against the available width after reserving 380 layout pixels for the conversation. The CSS cap applies independently of the resizer's asynchronous measurement. Existing PanelResizeHandle persistence, keyboard control, and pointer scale compensation were retained without edits. The compact drawer still ends at the dock's top through the shared dock-height variable.

The actual browser matrix covered **800, 1160, and 1440 viewport pixels × 100%, 125%, and 175% CSS zoom × sidebar enabled/disabled: 18 states per browser**. Tests exercise the application's zoom shortcuts, inspect root zoom, measure actual conversation/drawer/xterm bounds, and hit-test visible editor text, drawer close, dock Hide, terminal body, and the composer after dismissing its overlay. Native OS accessibility/webview qualification is not inferred from these browser measurements.

Measured conversation widths below use sidebar enabled, in layout pixels. All sidebar-disabled states also retained ≥380 layout pixels. JSON includes rendered bounds for every state.

| Viewport | CSS zoom | Overlay | Chromium conversation | WebKit conversation |
|---|---|---|---|---|
| 800 | 100% | No | 380 | 380 |
| 800 | 125% | Yes | 640 | 640 |
| 800 | 175% | Yes | 457 | 457 |
| 1160 | 100% | No | 466 | 466 |
| 1160 | 125% | No | 488 | 488 |
| 1160 | 175% | Yes | 663 | 663 |
| 1440 | 100% | No | 746 | 746 |
| 1440 | 125% | No | 458 | 458 |
| 1440 | 175% | No | 383 | 383 |

[Chromium geometry](final-integration-evidence/css-zoom-geometry-chromium.json) · [WebKit geometry](final-integration-evidence/css-zoom-geometry-webkit.json).

The first zoom-test iteration incorrectly hit the center of CodeMirror's full content box, below the visible scrollport at 175%. The corrected assertion hits the first visible text line; it does not relax the dock, xterm, conversation-width, or control hit-target constraints.

## Finding 3 — effective Terminal pressed state implemented

TopBar receives terminal visibility independently of the selected drawer tab. Terminal has active styling and `aria-pressed=true` while its dock is visible, false after Hide, and true after reopening. Files simultaneously remains pressed when its pane is selected. The dirty-file/single-shell regression asserts these transitions alongside actual command focus and shell reuse.

## Verification record

1. **68/68 passed on Chromium and WebKit**, one worker, covering flagship, Mac interaction, appearance, parallel, and tools specs. This includes reduced-motion cursor behavior, shell tab/reopen behavior, draft preservation, drawer focus restoration, pointer scaling in the existing appearance tests, and the zoom matrix. **This run precedes the final palette-close edit.** [Retained log](final-integration-evidence/targeted-68-before-palette-fix.log).
2. A subsequent narrower run strengthened the positive held-list assertion and saved geometry JSON: **8 passed, 2 failed**. Both failures were the new palette-focus test, one per browser; the held editor/composer/terminal focus cases and zoom matrices passed. [Retained pre-fix log](final-integration-evidence/held-focus-zoom-and-palette-before-fix.log).
3. After the functional palette correction, the affected-case attempt overlapped main's build of shared `dist-e2e`. It had **one pre-app-load failure, two passes, one interrupted test, and six not run** before this contributor stopped its own runner to leave main in control. A shared-build race is a plausible explanation for the boot failure, not a proven product diagnosis. **This is not a post-fix passing run.** [Interrupted log](final-integration-evidence/interrupted-after-palette-fix.log).
4. Targeted `useZoom`, `useAppearance`, and `TerminalPanel` units: **15 passed** before the final palette edit. Those include native-webview versus CSS-fallback behavior. TypeScript checks passed before browser work, including the command preceding the post-palette attempt. Main owns the final full-unit/typecheck snapshot.
5. My servers/runners are stopped. Ports 4178 and 4186 had no listeners at the last ownership check; main's independent 4187 process was left untouched. No further browser runs/builds were started after freeze.

Shared-output PNG copies are supporting visual snapshots only; successive browser runs share those filenames, so a particular browser is **not** attributed to them. Their original source paths, modification times, and hashes are retained in [manifest.json](final-integration-evidence/manifest.json). The per-browser JSON and logs above are the qualification evidence.

## Review-freshness P2 — main's recovery fix verified read-only

Main's `finishUndo` helper clears mutation state and increments `detailVersion` only when a selected path has no current detail. Both single-file and Undo All finalizers call it. This replaces an invalidated in-flight detail after rejected, busy, no-op, and single-error exits, while preserving valid detail from a later selection. Original responses remain rejected by request-generation ownership.

I read the four parameterized regressions: they hold the original detail, invoke each exit path, observe a replacement detail, then resolve the obsolete original and assert it cannot overwrite recovery. Main's [recovery log](final-integration-evidence/review-recovery-26.log) reports **26/26 passed**. This is a source check plus inspection of main's test evidence; I did not implement or rerun the recovery fix. The original audit P2 is **resolved by this source check and targeted evidence**. Final integration remains main's responsibility.

Verified `useReview.ts` SHA-256: `9f7ce4d409a663c73b3cf0b97a954e2e7f8f8f095ccaa9568a8a7078a25ced87`.

## Frozen implementation fingerprints

- `ui/src/App.tsx`: `9cce6b278a1b242655179658c04f1a853401bee5a9b6b7c957599d2d23164837`
- `ui/src/components/Drawer.tsx`: `f5bf03b42dc3aa6a17e155a0d52f48cfc25ade6e9fec0ed6fc8b0980a55071f9`
- `ui/src/components/TerminalPanel.tsx`: `c2bb36e573111c5724eac92443a986212cf151a88caa04a0196d148ca375ecdf`
- `ui/src/components/TerminalView.tsx`: `ca0877329712cb06a4c99a2a30ecea7a2e690aba2e36724c44354e9f41abbfb7`
- `ui/src/components/shell/TopBar.tsx`: `1760eb94af04bc1b39eb6be8688fa649ff2b18839c3365934a42986c29083663`
- `ui/src/hooks/useTerminalFocus.ts`: `96e4136eeabf0e3151d4624b3dc4222cd061ab8f7d04c4aab435c0be30feca2c`
- `ui/src/hooks/useWorkspaceLayout.ts`: `8b41df39e99e32e149cdac38f6a2b5a4913a625a0e9e17f7f9adf53aa2126c9c`
- `ui/src/flagship.css`: `c496a5614dc088d1dc5db6bd8d3bf1a35feb14a2657150e108aeec8639658c24`
- `ui/e2e/flagship.spec.ts`: `0140a4891e87a7ce357ee0c90a545e593785e04f117c83992be4e58759585913`
- `ui/e2e/macInteraction.spec.ts`: `66399354f4af06869dafc058b728579c63e3bc456e14ffa3b66b5df151e0d22f`

## Main final qualification, after source freeze

The frozen implementation passed **906 UI tests in 157 files**, TypeScript,
**154 full Chromium tests** and **35 focused WebKit tests**, including the final
palette-close focus regression. App hash remains `9cce6b278a1b242655179658c04f1a853401bee5a9b6b7c957599d2d23164837`.
No source edits occurred after the final bundles were generated. The final
ARM64 app passed strict/deep ad-hoc signature verification, packaged diagnostics
and two Python fixture tests. The source/evidence and binary hashes are in
[qualification-results.json](qualification-results.json). This closes the
previously pending integration reruns; the historical interrupted runs above
remain recorded, and native-window/release limits still apply.
