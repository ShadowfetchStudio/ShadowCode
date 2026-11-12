# Model cancellation reconciliation fix

2026-11-11. Addresses finding 4 in `reports/mac-ui-review.md`.

A rejected cancellation previously superseded the original model load's generation. The continuing load could then succeed without refreshing the catalog or notifying the parent, while Load/Remove were already enabled.

`LocalModelsPage.tsx` now tracks cancellation separately from load ownership. Only a successful unload advances the operation generation. A cancellation promise gates load completion/reconciliation while the unload request is outstanding. Rejected cancellation releases that gate and preserves the continuing load; pending controls remain disabled and Cancel is available for retry until the load settles. Eventual success refreshes the catalog using the existing endpoint, exposes the loaded model and enabled Unload controls, and invokes `onChanged`. The obsolete load-success toast remains suppressed after cancellation intent.

Successful cancellation still invalidates late load results, including pending catalog reads. Unmount still invalidates generations; late load/cancel completion cannot publish callbacks or start another catalog read. No native endpoint changes.

## Validation

From `/Users/shadowfetch/Projects/ShadowCode/ui`:

- `npm test -- src/components/settings/LocalModelsPage.test.tsx`: **10 passed, 0 failed**, one file, 508 ms.
- `npm run typecheck`: **passed** (`tsc --noEmit`).
- `git diff --check`: **passed**.

Deferred-promise component tests cover refused cancellation followed by the actual load endpoint's `{ok:true, loaded:...}` response and fresh loaded catalog; disabled pending controls and retry availability; load completion before either successful or rejected cancellation; a successful retry after cancellation failure; both requests failing; successful-cancel late-result suppression; and load/cancel completions after unmount. The existing placement-label test remains passing.

Owned files: `ui/src/components/settings/LocalModelsPage.tsx`, `ui/src/components/settings/LocalModelsPage.test.tsx`, and this report. Other contributors' changes preserved. No commit, Cargo build, real model execution, or native/browser end-to-end cancellation validation performed for this UI fix.
