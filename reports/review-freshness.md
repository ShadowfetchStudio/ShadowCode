# Revision-aware review markers

Implemented without a commit. Scope is limited to `ui/src/hooks/useReview.ts`, the two existing `ReviewView` test files, `native/core/src/review.rs`, the `ReviewFile` type in `ui/src/api.ts`, review response handling in `ui/e2e/fakeBackend.ts`, and this report. Concurrent local-model and shell changes were preserved.

## Behavior

Native review summaries now include the same current `Snapshot.hash` already supplied by details. Deleted files use `missing`; unreadable/unavailable rows have no hash. List/detail content identity is computed from the same snapshot within each response. The fake backend propagates its deterministic content identity in both responses, including a distinct deleted-file identity.

The existing per-task storage key now contains version 2 file marks `{path, hash}` and hunk marks `{path, id, hash}`. Old path-only storage is ignored, as are malformed/empty identities. Persisted marks are not exposed until a fresh task listing validates them. Matching marks survive reopening; changed, absent, unchanged or unavailable rows prune their marks from storage. Once a changed revision has been observed, returning to older bytes cannot resurrect an invalidated mark. Missing digests from older engines fail closed rather than upgrading old marks to the current revision.

Keep records the digest of the displayed detail only when it matches the current summary. It does not write files or stage Git changes. File-wide content changes invalidate hunk marks conservatively even when hunk IDs are reused. The public hook still returns path/hunk-key arrays, so production ReviewView rendering required no changes.

Task-owned request generations reject stale list/detail responses, including responses overtaken by Keep, Undo, selection or a task switch. List/detail revision disagreement does not display an accepted marker for unseen content; a later refresh retries. Switching files during an in-flight undo preserves the newly selected detail. Workspace-file notifications and window focus/visibility recheck the listing; the existing shared five-second visible-document cadence also detects changes made outside the renderer. A notification clears visible validation immediately; an external change without a notification is detected on refresh, not claimed to be instantaneous filesystem watching.

Undo All revalidates the listing before selection and skips only whole-file marks that still match. Hunk-only marks retain the previous behavior: they do not exclude the file from Undo All. The operation remains task-scoped, cannot add newly discovered paths beyond those displayed at invocation, and stops subsequent work after unmount/task navigation. Existing backend undo/checkpoint conflict protection is unchanged. This is content-revision tracking, not a new atomic cross-file transaction or a digest of Git baseline/mode metadata.

## Verification

- `./node_modules/.bin/vitest run src/components/ReviewView.test.tsx src/components/ReviewView.opinion.test.tsx`: **22 passed**, including 12 new freshness/race regressions plus existing review, rewind and opinion coverage.
- `./node_modules/.bin/tsc --noEmit`: **passed** after the final changes.
- Targeted Prettier formatting and `git diff --check`: **passed**.
- Native regression added in `review.rs`: verifies summary/detail hash agreement, external modification without another checkpoint, binary content, deletion versus empty content, and unavailable paths.

The UI regressions cover visible Keep removal after an external change, matching-revision restoration, legacy storage rejection, absent hashes, unavailable files, late list/detail responses, mismatched summary/detail reads, task isolation, same-revision focus refresh, a pre-undo response, changing selection during undo, and Undo All skip semantics.

## Native validation handoff

No Cargo or rustfmt command was started, honoring the explicit requirement to coordinate before native commands. The available desktop messaging tool rejected sending to this task's native ancestor and directed use of native collaboration; no native collaboration messaging tool is exposed in this session. The main coordinator should include the following in its coordinated external-toolchain run:

```sh
cargo test --locked -p shadowcode-core --lib review::tests -- --test-threads=4
```

Use the project's already-established external Cargo/Rustup/target/temp environment. The native test and Rust formatting remain unverified here; there is no claimed native test pass, packaged-app check or end-to-end browser run for this subtask.
