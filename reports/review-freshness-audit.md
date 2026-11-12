# Review freshness audit — November 11, 2026

Read-only review of Sagan's working-tree changes against `82c60ee`, focused on `ui/src/hooks/useReview.ts`, `native/core/src/review.rs`, and the related ReviewView tests. No production or repository test files changed in this audit. No browser or Cargo process started.

## Finding: P2 — Undo cancellation can strand an in-flight selected diff

**Location:** `ui/src/hooks/useReview.ts:324–330`, with the missing recovery in `undoAll` at lines 374–391 (also the rejected single-undo path at lines 360–365).

`beginUndo()` increments `scope.detailRead`, rejecting any selected-file detail request already in flight. If Undo All's fresh listing reports busy, has no remaining eligible files, or its first undo request rejects, execution never reaches `undoOne`'s successful recovery. The finalizer only clears `mutation` and publishes. It does not schedule replacement detail work. The rejected old detail response is ignored; subsequent successful list refreshes with the same selected path/hash do not change the detail effect's dependencies. The selected diff therefore remains blank, including after an explicit successful reload. Clicking the already-selected file is also a no-op. Changing selection away/back or a focus/workspace invalidation can recover it.

**User-reachable trigger:** the task file list has loaded and Undo All is enabled while the selected file's slower detail request is still pending. Confirm Undo All, then have the backend reject the operation (for example, a workspace reservation becomes busy). The same failure occurs without an error if another remaining file becomes unchanged before Undo All's fresh listing, leaving the selected, already-kept file excluded from undo and no work to execute.

**Evidence:** two isolated hook reproductions exercised the actual production hook with deferred detail promises. Both observed a successful same-revision reload afterward, `working === false`, no replacement `reviewFile` call, and `detail === null`. The rejection case also observed the expected error toast; the no-op case issued no undo mutation. These reproduce a UI recovery defect, not demonstrated file loss.

**Minimal correction for the owner:** after undo completion/early return/failure, ensure an invalidated selected detail request is replaced when no valid detail exists. Use a deliberate detail retry generation or equivalent ownership-aware recovery; retain stale-response rejection and avoid refetching a newly selected valid detail unnecessarily.

**Acceptance test:** defer the selected detail, invoke Undo All while the list is ready, reject the first undo (and separately return an empty eligible set or busy listing), then resolve the original detail. Verify the old response is ignored, a replacement detail request resolves, and the current diff becomes visible without changing selection or window focus. Retain the existing selected-file-switch-during-undo regression test.

## Other conclusions

- **No autonomous render/request loop reproduced.** With stable production-style callbacks, ten explicit rerenders left list/detail request counts at one each. Scope, `load`, `persist`, and `publish` identities are stable within a task; detail publication is not itself a detail-effect dependency.
- **Revision markers:** current summary/detail hash agreement, legacy rejection, task-owned generations, invalidation on differing revisions, and conservative hunk invalidation are coherent. Existing tests verify stale list/detail suppression, task switching, absent hashes, unavailable rows, and matching-revision restoration. No additional stale-marker regression established.
- **Native hash change:** summary and detail now derive the digest from the same `Snapshot` within each response. Missing files retain the distinct `missing` identity; unavailable summaries omit a hash; binary and empty contents remain distinct. The added Rust regression covers these cases. Separate list/detail reads are correctly treated as potentially different revisions by the UI.
- **Undo safety:** Undo All revalidates whole-file marks, excludes paths absent at invocation, and stops further operations after task scope disposal. The native service still acquires a workspace reservation; writes/deletes retain their current-snapshot conflict checks. This change does not add a displayed-revision precondition to the whole-file undo API or an atomic multi-file transaction; those are existing semantics, not newly attributed regressions.

## Verification and limits

- Existing `ReviewView.test.tsx` plus `ReviewView.opinion.test.tsx`: **22/22 passed** in this audit.
- Temporary audit harness: **3/3 passed** — two assertions of the reproduced defective state above and one no-loop control. Passing the reproduction tests means the defect was observed; it does not mean the defect is fixed.
- Harness: `/private/tmp/shadowcode-review-audit/freshness.test.tsx`; command: `./node_modules/.bin/vitest run --root /private/tmp/shadowcode-review-audit --config /private/tmp/shadowcode-review-audit/vitest.config.mjs`, from `ui`.
- The current tests cover successful undo after detail is ready, not failed/no-op undo while detail is pending. They therefore pass despite the finding.
- Rust tests were inspected, not executed. Main retains native/full-suite qualification. No code fixes were made or coordinated by this audit.

## Inspected SHA-256 fingerprints

- `ui/src/hooks/useReview.ts`: `2ecbebd371f942344d105fc9a7925fb7cbd84dbd9b64ddfc6f5cd687cc3a8f6d`
- `native/core/src/review.rs`: `a5cd5c84013e8bb943cb889bca984441174c4a81e82ecc29503aebb991d18e4e`
- `ui/src/components/ReviewView.test.tsx`: `beb087eaf6a88ef5ace4ebacf87ec0cead635c63dccf86f37ed975a8851d30b6`
- `ui/src/components/ReviewView.opinion.test.tsx`: `8e702859d196a58c419c8ab2647b8d13e5f9dfa7090ba06d38dc3c590f90d1a1`


> Later integration results are recorded in [the implementation and qualification record](../docs/MAC_FLAGSHIP_UPGRADE.md) and [the final resolution](final-integration-resolution.md). Historical test counts and pending statements in this report describe its own source snapshot.
