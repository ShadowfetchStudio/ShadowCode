# Final integration correctness review

November 11, 2026. Read-only review of the current working tree against HEAD. **Two P2 findings and one P3 finding remain below. No code, tests, configuration, or other reports were changed.** Only this report was written. Main owns any resulting code edits.

The review-marker implementation is frozen: this review made no further changes to `useReview.ts`, its tests, the API review type, native review code, or fake-backend review handling. This is an authorship freeze, not an assertion that other contributors cannot change shared files.

## Findings

### 1. [P2] Delayed terminal mounting can override a newer editor/composer focus choice

**Locations:** [App.tsx:184](<../ui/src/App.tsx>), [App.tsx:1027](<../ui/src/App.tsx>), and the existing unconditional mount focus at [TerminalView.tsx:131](<../ui/src/components/TerminalView.tsx>). The asynchronous list boundary is in [TerminalPanel.tsx:76](<../ui/src/components/TerminalPanel.tsx>).

**Trigger:** Hide an already docked terminal. Reveal it with Terminal, then focus the still-visible file editor or composer before the terminal list request completes. When the list resolves, `TerminalView` mounts and calls `term.focus()` unconditionally. A lazy module load can create the same interval. A workspace change also rekeys the dock's `TerminalPanel`, creating a fresh asynchronous mount without a new explicit terminal-focus request.

**Consequence:** The user's newer focus choice is lost. Subsequent typing can go to the shell rather than the editor/composer. The new App effect explicitly relies on the child taking focus after its asynchronous load, but neither the focus request nor the child's mount checks whether the user has moved elsewhere. Dialog containment protects an open modal; it does not protect the ordinary file editor or composer.

**Evidence strength:** High-confidence control-flow finding; not executed in this review. The unconditional child focus predates this change, but the new simultaneous dock/editor lifecycle exposes it after a dock reveal and workspace rekey. Existing dock tests wait for the terminal to be ready before asserting command focus; they do not hold terminal listing pending while choosing a newer focus target.

**Minimal correction:** Make focus on terminal readiness conditional on the current explicit focus request still owning focus. Invalidate that request after a newer user focus choice; do not treat every terminal remount as a request to focus the shell. Preserve intentional toolbar/shortcut focusing when no newer choice intervened.

**Acceptance for main:** Hold the terminal-list response pending, reveal the dock, focus and type in a dirty editor, then release the response. Editor focus and content remain intact; subsequent typing does not produce terminal input. Repeat with the composer and a workspace change while the dock is visible. Separately verify that revealing the dock without intervening focus still focuses the existing shell and opens no duplicate shell.

### 2. [P2] CSS zoom leaves the split layout active below its usable width

**Locations:** [PanelResizeHandle.tsx:32](<../ui/src/components/shell/PanelResizeHandle.tsx>), [flagship.css:159](<../ui/src/flagship.css>), [flagship.css:164](<../ui/src/flagship.css>), and [App.tsx:123](<../ui/src/App.tsx>).

**Trigger:** In a plain browser/remote UI, or the desktop's CSS-zoom fallback, use 175% text size at a 1160px-wide viewport with the sidebar and Files open. CSS zoom reduces the application's layout width to approximately 663px, but the 1150px sidebar-collapse and 760px drawer-overlay media queries still see the unzoomed viewport. App's `matchMedia` uses the same unzoomed threshold.

**Consequence:** The sidebar continues to reserve 254 layout pixels. The resizer clamps the panel to at least 320 even though `app.clientWidth - rail - 380` is negative. Only about 89 layout pixels remain for the conversation/composer, far below the handle's stated 380px reserve. Resizing down cannot recover the space because the panel is already at its minimum. At 800px/175%, the sidebar collapses but the side panel still consumes 320 of approximately 457 layout pixels rather than becoming an overlay.

**Evidence strength:** High-confidence layout constraint finding; dimensions above are arithmetic from source, not measured browser output. Root CSS zoom is explicit in [useZoom.ts:31](<../ui/src/hooks/useZoom.ts>). The [Vite transform](<../ui/vite.config.ts>) rewrites viewport units in declaration values only; it does not adapt media-query breakpoints. Native webview zoom normally adjusts layout/media-query coordinates and is not the affected path. This includes an inherited breakpoint mismatch; the new split-width policy still does not satisfy its promised conversation reserve under that supported zoom path.

**Minimal correction:** Base compact-mode selection on effective layout width, consistently across App and the CSS layout, and use the compact arrangement when sidebar + minimum panel + conversation reserve cannot fit. Retain the existing zoom compensation for pointer dragging and terminal measurement.

**Acceptance for main:** Exercise 100%, 125%, and 175% CSS zoom at 800, 1160, and 1440 viewport widths with sidebar/panel combinations. Where a split is shown, retain at least 380 layout pixels for the conversation; otherwise enter the compact layout and preserve reachable sidebar/panel controls. Check actual editor/composer control hit targets and drawer/dock overlap. Current flagship dock geometry tests vary viewport dimensions but do not set CSS zoom.

### 3. [P3] Toolbar exposes a visible docked terminal as unpressed

**Locations:** [App.tsx:823](<../ui/src/App.tsx>) and [TopBar.tsx:86](<../ui/src/components/shell/TopBar.tsx>).

**Trigger:** Dock Terminal while Files remains selected. The dock is visible and Terminal commands correctly focus it, but App supplies only `panel="files"` to TopBar. Both the Terminal active class and `aria-pressed` derive solely from `panel === "terminal"`.

**Consequence:** The visual/accessibility state reports Terminal inactive while its surface is open. The earlier routing defect is fixed, but this small state-reporting part of the original finding remains.

**Evidence strength:** Direct prop/value trace; no runtime reproduction required to establish the false boolean.

**Minimal correction and acceptance:** Supply effective terminal visibility separately from the side-panel tab. Assert Terminal pressed when the dock is visible, unpressed after Hide, and pressed after reopening; Files should remain pressed while its pane remains selected. Preserve the current command behavior and single-shell reuse.

## Areas reviewed without an additional actionable finding

- **Prior dock geometry fixes:** The dock screen now overrides the inherited minimum/height and flexes within its row. The compact drawer bottom and dock row use the same `--terminal-dock-height`. The viewport-unit transform applies to that custom-property value. I did not re-report the earlier default-zoom overlap or clipping defects as current bugs.
- **Drawer close focus:** The close path checks whether the removed drawer owned focus and respects an intervening active element. Pre-pointer focus/opener capture addresses the documented WebKit button behavior. This is distinct from the asynchronous terminal focus issue above.
- **Panel resizing:** Pointer delta compensates for rendered/layout scale; observer teardown and CSS-property cleanup are present. The actionable issue is insufficient-width mode selection, not pointer scaling.
- **Shortcuts:** The current diff preserves Mac Command+M and Command+grave, routes Terminal through Control+grave on Mac, ignores composition events, and guards Alt+Up/Down in editable fields. No additional concrete regression was found in the changed routing/hints.
- **LocalModelsPage cancellation:** Rejected unload retains the original load ticket and releases the cancellation gate; the continuing load can reconcile and notify the parent. Successful unload supersedes the ticket and owner-bound catalog reads. Cleanup invalidates late load/cancel callbacks. The historical rejected-cancel finding is resolved by inspection. The deferred-promise scenarios described in [model-cancellation-fix.md](model-cancellation-fix.md) support that conclusion; they were not rerun here.
- **Native bounded review:** The fresh shared-memory check occurs before child spawn, including CPU retry, and excludes unknown/inconsistent samples and unidentified/discrete devices. Cache arguments are revision-gated. Health/properties awaits now select cancellation, terminate the child, and recheck before publication. No additional actionable defect was found in these changed paths. This is not a real-model memory benchmark, an atomic cancellation guarantee after the final publication check, or an audit of all runtime internals. See [silicon-fixes.md](silicon-fixes.md) for the author's validation and explicit limits.

## Validation provenance and handoff

No builds, tests, browser execution, or process control were performed for this review. All findings are based on current source/diffs and existing reports. The author of [mac-ui-review.md](mac-ui-review.md) records 36 passing Chromium/WebKit acceptance tests for the earlier dock fixes. The model-cancellation report records 10 passing component tests and a passing typecheck. These are recorded results, not independently rerun results.

Main reports that the full core-library suite includes `review::tests`, rustfmt passed, and the final UI unit snapshot passed 902 tests. Main also reports that the full Chromium suite was built around 19:25 and remains running. This review does not claim that run finished, and does not establish that its built snapshot includes every concurrent edit. Main should qualify any subsequent fixes with affected tests and the final integration snapshot.

The report prioritizes correctness fixes over redesign. No finding asserts that the broader flagship upgrade, native accessibility qualification, or release qualification is complete.

## Source fingerprints at report creation

These SHA-256 fingerprints distinguish the inspected working-tree sources from concurrent/future changes. Line links above refer to this review's source snapshot.

- `ui/src/App.tsx`: `fb4eaea5c4a1723533f1cd45495426151dbfdc7642d254a84962e2cf0c6bce44`
- `ui/src/components/Drawer.tsx`: `3baa592cbdb316bf75978bbb64302b8a66f9ed9b5cc614ff20d5aa265cbe7455`
- `ui/src/components/TerminalView.tsx`: `c0f37f9a227e14938451ceaaca21579ea61ee7308dfc796d1ec729a08545cf75`
- `ui/src/components/TerminalPanel.tsx`: `d861b4fcbb6e620f89233b20aad8670cb76184cc743ad29ccca41d2ff905189b`
- `ui/src/components/shell/PanelResizeHandle.tsx`: `0fa93a6821824eeedc9e3b0e7affe180381342384b3c2519b2d9a88eeda3fb50`
- `ui/src/components/shell/TopBar.tsx`: `8d169d62f2a07c6ad4a101c957802c5362aee57b7fa0cc1f5b4b5b223492f7bc`
- `ui/src/flagship.css`: `4cd38bb9a8ee4d868fd7b971f4a3c8a5785d661a0d451d407a127f5fde2a745a`
- `ui/src/hooks/useShortcuts.ts`: `3acd7ea8d886724d5b7d0c90229137ae9fb0b70ef022a17b1626ea92e351d171`
- `ui/src/lib/shortcuts.ts`: `53485a403d6bed24934133a2b424266b24b6363535b98218a28589730f5b816a`
- `ui/src/components/settings/LocalModelsPage.tsx`: `52fd8c59d9e81584b229e3d52065da01040ff45bfea199bfc1379031543fe7b7`
- `native/core/src/local_engine.rs`: `7da326028d1ed68e5c3f692c1484ef5a821833868546ff49c64172c5dba060d0`
- `native/core/src/local_runtime.rs`: `b8274e7e16cde3dc1e6c651aaa34dc301bae060ea1d289e9eaae9f6d94475757`
- `ui/src/hooks/useReview.ts`: `2ecbebd371f942344d105fc9a7925fb7cbd84dbd9b64ddfc6f5cd687cc3a8f6d`
- `ui/src/components/ReviewView.test.tsx`: `beb087eaf6a88ef5ace4ebacf87ec0cead635c63dccf86f37ed975a8851d30b6`
- `ui/src/components/ReviewView.opinion.test.tsx`: `8e702859d196a58c419c8ab2647b8d13e5f9dfa7090ba06d38dc3c590f90d1a1`
- `native/core/src/review.rs`: `a5cd5c84013e8bb943cb889bca984441174c4a81e82ecc29503aebb991d18e4e`


> Later integration results are recorded in [the implementation and qualification record](../docs/MAC_FLAGSHIP_UPGRADE.md) and [the final resolution](final-integration-resolution.md). Historical test counts and pending statements in this report describe its own source snapshot.
