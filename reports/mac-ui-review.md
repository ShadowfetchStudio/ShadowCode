# Focused Mac UI regression review

Reviewed November 11, 2026, against baseline `82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0`, including new untracked shell components/styles. The working tree was changing during review; the fingerprints below identify the final inspected source. This review is restricted to acceptance semantics, accessibility, and concrete regressions in the current implementation. No broader redesign is proposed.

**Result: four actionable findings — one P1, three P2.** Production source and tests were not edited. The ongoing main test suite was neither launched nor interrupted. This report is the only repository file written by this reviewer.

## Findings

### 1. [P1] Fit the terminal screen inside the new bottom dock

**Location:** [flagship.css:307](<../ui/src/flagship.css>), with the dock track at [flagship.css:268](<../ui/src/flagship.css>). Existing terminal sizing is [tools.css:56](<../ui/src/tools.css>).

**Trigger:** Open Terminal, then “Dock terminal below workspace” in an ordinary 900px-high window. Populate enough output to put the prompt near the terminal's final row.

**Defect:** The new dock allocates `clamp(170px, 28vh, 300px)`, but its reused `.terminal-screen` retains `min-height: 260px` and viewport-based height. Setting `min-height: 0` only on `.terminal-panel` does not remove the child's minimum. The terminal therefore extends beneath the viewport after accounting for the dock header, tab strip, and explanatory text. The body hides overflow. xterm fits its rows to the larger terminal element, so its last rows/prompt can be outside the visible window.

**Evidence:** An isolated Chromium page using the actual current `tokens.css`, `index.css`, `workspace.css`, `tools.css`, and `flagship.css`, with the corresponding terminal structure, measured at 1440×900:

- dock: top 648, bottom 900, height 252;
- terminal panel: top 689, bottom 900, height 211;
- terminal screen: top 747, bottom **1007**, height **260**.

The same 107px overflow occurred at 1024×900. This is a measured CSS integration failure, not a claim from merely inspecting the fixed height. The isolated fixture did not start a shell or use the main app server.

**Minimal correction:** Give terminal screens inside the dock a dock-specific `min-height: 0` and available-height sizing, preserving sidebar terminal sizing. Ensure headers cannot consume all remaining screen space. Let the existing ResizeObserver/FitAddon see the actual visible cell area.

**Acceptance:** At supported window heights and increased zoom, `.terminal-screen.bottom <= .terminal-dock.bottom`; a prompt after a full screen of output remains visible and keyboard input lands on visible rows. Existing tests that locate transcript text do not establish this geometry.

### 2. [P2] Do not let the compact side-panel overlay cover the newly docked terminal

**Location:** [flagship.css:164](<../ui/src/flagship.css>), combined with [App.tsx:850](<../ui/src/App.tsx>). Inherited overlay bounds are [workspace.css:1017](<../ui/src/workspace.css>).

**Trigger:** At 760px or narrower, open Terminal and select “Dock terminal below workspace”; alternatively dock at a wide size and then narrow the window while Files is open.

**Defect:** Docking sets `panel` to Files. The compact drawer remains fixed from 55px below the top to the **bottom of the whole window**, above the dock at z-index 14. Its bounds are not adjusted for the new terminal row. It covers the right-hand dock content and the dock's Hide/Move controls; covered terminal controls remain in the keyboard order. This makes the newly revealed terminal partially inaccessible immediately after the docking action.

**Evidence:** In the same isolated CSS reproduction at 760×900, the dock occupied y=648–900 while the drawer occupied y=55–900. `elementFromPoint(710, 880)` returned `drawer`, not the terminal beneath it. The bottom right controls and content are therefore obstructed independently of finding 1.

**Minimal correction:** Define compact dock/side-panel coexistence deliberately: constrain the side overlay to the upper workspace region when docked, or close the side overlay when docking compactly. Preserve a visible route to both surfaces. Do not leave focusable dock controls behind the covering pane.

**Acceptance:** Dock at 760 and 520 widths, then reach the terminal prompt, Hide, and Move using pointer and keyboard. Assert that their center-point hit targets belong to those controls, not merely that their rectangles intersect the viewport.

### 3. [P2] Route Terminal commands to the dock after docking

**Location:** [Drawer.tsx:227](<../ui/src/components/Drawer.tsx>), with the new dock integration at [App.tsx:849](<../ui/src/App.tsx>). Shared routing is currently [App.tsx:497](<../ui/src/App.tsx>) and the toolbar callback at [App.tsx:720](<../ui/src/App.tsx>).

**Trigger:** Dock a terminal, leave Files open, and focus the file editor or composer. Use the Terminal toolbar button or the existing terminal shortcut.

**Defect:** Both entry points still only toggle `panel === "terminal"`. Once docked, that drawer tab contains a hint, not a terminal. The action replaces Files with a redundant message and never focuses the existing docked terminal. The normal terminal shortcut no longer reaches the shell, and its next invocation toggles the placeholder rather than the terminal. The toolbar's pressed state follows the placeholder tab, not the visible dock.

**Evidence:** Source trace: `terminalDocked` suppresses the drawer's `TerminalPanel`; `onPanel` and the shortcut do not inspect dock state; neither has a focus path to the dock. There remains exactly one mounted terminal view, which is good, but the command semantics were not extended with its new location. This finding is source-verified; the full native keyboard sequence was not executed.

**Minimal correction:** When docked, route the existing Terminal action to reveal/focus that terminal without replacing Files. If the command is intended to toggle terminal visibility, apply it to the active terminal location. Keep selected/accessibility state consistent with the chosen behavior and restore focus when hiding.

**Acceptance:** With a docked terminal and an open dirty file, invoke Terminal from the editor using the toolbar and keyboard; the same terminal receives focus, the file stays visible, and no duplicate shell is opened. Verify behavior when focus is already inside the dock as well.

### 4. [P2] Retain load reconciliation when cancellation fails

**Location:** [LocalModelsPage.tsx:99](<../ui/src/components/settings/LocalModelsPage.tsx>) and [LocalModelsPage.tsx:111](<../ui/src/components/settings/LocalModelsPage.tsx>); the cancel action starts at [LocalModelsPage.tsx:228](<../ui/src/components/settings/LocalModelsPage.tsx>).

**Trigger:** Start a model load, then cancel while preparation is pending. The unload request fails, for example with a transport error, while the original load continues and later succeeds.

**Defect:** `run("cancel", ...)` increments the same operation generation used by the load. On cancellation failure, its catch refreshes the catalog once and its finally clears `pending`. The original load is permanently stale and returns before refreshing the catalog or invoking `onChanged`. If the error-time snapshot still says no model is loaded, the UI keeps that false state after loading finishes, removes Cancel, and re-enables Load/Remove. A failed cancellation should not discard the still-running operation's reconciliation.

**Evidence:** Executed the actual current `LocalModelsPage.tsx`, transpiled in memory with React/Testing Library/happy-dom and mocked API boundaries. The load promise was held pending; unload rejected; catalog initially reported unloaded; then the backend catalog changed to loaded and the original promise resolved with the real endpoint's `{ok:true, loaded:...}` shape. Observed:

```json
{
  "after_failed_cancel": {
    "loadEnabled": true,
    "cancelVisible": false,
    "changed": 0
  },
  "after_real_load_finishes": {
    "uiSaysUnloaded": true,
    "unloadVisible": false,
    "changed": 0
  }
}
```

An error toast was correctly emitted; no successful-cancellation toast appeared. The defect is lost state reconciliation, not the toast. The newly added refused-unload test checks the error and suppresses a late success toast but does not assert the actual loaded state or continued pending behavior.

**Minimal correction:** Track cancellation intent separately from load ownership, or restore/reconcile the original operation if cancellation is refused/unknown. It is fine to suppress an obsolete success toast, but the real loaded catalog and availability must still refresh. Keep controls accurately pending until the continuing operation settles or its status is established.

**Acceptance:** Reject cancellation before load completion, subsequently return a loaded model, and verify the UI shows that model with an available Unload action and notifies the parent. Preserve the existing successful-cancel and unmount suppression behavior.

## Reviewed without an additional concrete regression finding

- **Project-scoped newSession queue:** creation is on the activation queue, has an operation latch, and checks selection ownership before activating its new session. A later selection is queued after creation and owns the React update. `openSession` increments the ticket and clears its own switching state; the outer finally's different ticket is not itself a stuck-switching bug. The inspected acceptance test covers delayed creation followed by selecting an existing conversation. I did not find a new, sufficiently evidenced queue regression to report.
- **Resizer:** current code includes controlled-pane ARIA, min/max/current values, pointer capture/cancel cleanup, Enter reset, zoom-adjusted drag deltas, and separate preferred versus effective width. No concrete clamp/accessibility regression was established in the inspected changes. That is not a native VoiceOver pass.
- **WorkspaceContextBar/RunCheck:** origin is frozen, execution is blocked after session/workspace changes, submission preserves normal API/approval handling, and there is no passing-check claim inferred from task completion. I checked a suspected fixed-dialog/container interaction: isolated Chromium and WebKit both kept the modal backdrop at 0,0 with 1440×900 bounds even with the new `.stage` container rule, so that suspicion is explicitly rejected.
- **Earlier baseline issues now addressed:** Changes toggles only Changes, and the compact sidebar control now closes the obstructing panel and reveals navigation. Do not re-file those earlier research findings as unresolved.

## Verification limits and source snapshot

Two isolated headless browser fixtures and one in-memory React component exercise were used; none connected to the native engine, started real jobs, downloaded/loaded models, or wrote test files. Main acceptance tests were read but not rerun. Terminal findings 1–2 are CSS/DOM reproductions, finding 3 is source tracing, and finding 4 is a mocked-boundary component reproduction. Native VoiceOver and real xterm prompt interaction remain follow-up checks. No full native runtime review or release qualification is implied.

Final inspected file SHA-256 values:

- `ui/src/App.tsx`: `637b1467f4867ce26796dbd97a3a2c6cbc557a2f9f5ea6f9c506bac371216604`
- `ui/src/components/Drawer.tsx`: `093a477f7b346f4137219b70c616fed65b21bf94a7868ce8880050513b8adad5`
- `ui/src/components/settings/LocalModelsPage.tsx`: `326272294dfa4dc0d6a841315f40fb23e3540bd242de784f5ca581f4a4d68346`
- `ui/src/components/shell/PanelResizeHandle.tsx`: `0fa93a6821824eeedc9e3b0e7affe180381342384b3c2519b2d9a88eeda3fb50`
- `ui/src/components/shell/WorkspaceContextBar.tsx`: `b4b163ca38fbc850e3318a97cd86cb4bc13c0194b54d93a5f16c7f1301e933a3`
- `ui/src/flagship.css`: `6f1afb612585bab1f29cc7a84231b9939a4297736e7fdcfa18e81678bb1c5c48`
- `ui/src/hooks/useNavigation.ts`: `5242d0593a0f242fdfdda5d7160c932809922dac9a6a57b0bd1f7f2d0903e4ea`


## Implementation resolution: findings 1–3

Implemented November 11, 2026, following explicit authorization. The original review above is historical; its read-only statement and source fingerprints describe the initial audit, not this implementation follow-up. Findings **1, 2, and 3 are resolved** in the inspected working tree. Finding 4 was outside this implementation's file ownership and was left to the main work.

- **Terminal geometry:** dock-specific screen rules remove the inherited 260px minimum/viewport height. The terminal flexes into the space left by header, tabs, and hint. The dock height is shared with compact overlay positioning.
- **Compact overlay:** when docked, the fixed side panel ends at the dock's top instead of extending over it. Pointer hit tests cover Hide, Move, terminal body, and the final output row.
- **Routing and focus:** the existing panel entry points route Terminal to the dock when dock placement is selected. Files and its unsaved buffer remain selected. Hiding restores the preceding workspace focus and retains dock placement; reopening reuses the same shell. Moving back to the side panel also keeps the same shell.
- **General drawer closing:** pointer/keyboard closure restores the opener only if the disappearing drawer owned focus. A later focus choice wins. Pre-pointer focus and opener capture account for WebKit's button-focus behavior; opener cleanup uses a timer because WebKit can run microtasks between native capture and bubble listeners.
- **Screenshot readiness:** theme/viewport screenshots now open README.md and verify its actual editor text before capture. Dock captures wait for both rendered README content and terminal output.

### Validation evidence

The final isolated run passed **36/36 tests**: `flagship.spec.ts` (10), `macInteraction.spec.ts` (2), and `parallel.spec.ts` (6), each on **Chromium and WebKit**. It used the existing fake backend/tools boundaries, actual React/CodeMirror/xterm rendering, one worker, and a temporary test-transport Vite server on port 4186 to avoid the main suite's port 4178. The temporary server was stopped afterward. Final run state: [/tmp/shadowcode-terminal-fixes/results/.last-run.json](/tmp/shadowcode-terminal-fixes/results/.last-run.json), status `passed`, no failed tests.

Command:

```sh
./node_modules/.bin/playwright test --config=/tmp/shadowcode-terminal-fixes/playwright.config.mjs flagship.spec.ts macInteraction.spec.ts parallel.spec.ts
```

Added acceptance checks verify:

1. Dirty README text remains visible and unchanged when invoking Terminal from the toolbar, editor shortcut, and inside the dock.
2. Hiding restores editor focus; reopening returns to the same terminal ID; only one terminal view and one shell-creation POST exist.
3. At 1440×900, 1024×640, 760×900, and 520×640, the actual `.xterm-screen`, terminal wrapper, and final rendered row stay within the dock/window.
4. Compact controls and output points hit the terminal rather than the side overlay. Twelve real keyboard-entered fake-shell commands place the prompt on the last visible row, which remains visible and unobstructed.
5. Close button and Escape restore the Files opener; a newer focus choice made in the same turn is not overwritten.
6. Mac shortcut hints, runtime reduced-motion cursor behavior, and parallel-workflow tests pass with the main contributor's changes.

Earlier iterations caught and corrected one over-strict test assumption (xterm's own viewport, not the text row, owns pointer input) and a real WebKit close-focus defect. An accidental `--browser=all` run encountered ten Firefox launch failures because Firefox was not installed; no browser was downloaded. That run is not claimed as a passing suite. The final Chromium/WebKit-only run above is the acceptance result.

The targeted production-build runs included successful TypeScript checks before the final event-cleanup adjustment; the main contributor owns final typecheck/unit/full-suite qualification. Native VoiceOver and installed-app qualification are not implied by these browser results. No commit was created, and no shortcut files or TerminalView implementation were edited here.

### Final implementation fingerprints

- `ui/src/App.tsx`: `fb4eaea5c4a1723533f1cd45495426151dbfdc7642d254a84962e2cf0c6bce44`
- `ui/src/components/Drawer.tsx`: `3baa592cbdb316bf75978bbb64302b8a66f9ed9b5cc614ff20d5aa265cbe7455`
- `ui/src/flagship.css`: `4cd38bb9a8ee4d868fd7b971f4a3c8a5785d661a0d451d407a127f5fde2a745a`
- `ui/e2e/flagship.spec.ts`: `5f497ca8ea4d0b7800196c9b6802561242572566ccf2880ebf5f5831ea3c58d3`

### Durable visual evidence

The main Chromium suite regenerated these captures from the same flagship assertions after its output cleanup. Copied as real PNG files while that suite continued; no additional browser was launched. README content and xterm output readiness are asserted before capture.

- [1440px dock capture](visuals/mac-terminal-fixed-1440.png): 1440×900; SHA-256 `a9f9d5bfdc3574b1c1c3a3c478abccb85aba548668c1a612a3a6a3332ac21842`.
- [520px dock capture](visuals/mac-terminal-fixed-520.png): 520×640; SHA-256 `0cf1db7e7d99a3f450c424d218661e6e14dfecbd9c6d63d3402429ef6b5feb26`.


> Later integration results are recorded in [the implementation and qualification record](../docs/MAC_FLAGSHIP_UPGRADE.md) and [the final resolution](final-integration-resolution.md). Historical test counts and pending statements in this report describe its own source snapshot.
