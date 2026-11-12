# macOS sandbox temp-directory metadata fix

2026-11-11. **Fixed the Apple developer-tool failure with external TMPDIR.** Cargo has been released to main for the app build; this task will run no further Cargo commands.

## Diagnosis and narrow policy change

The full core run recorded in `reports/native-core-lib.log` had 675 passed, 1 failed, and 8 ignored. The failing `sandbox::tests::apple_developer_tools_run_cleanly_in_the_seatbelt` emitted `xcrun_db-*` cache creation errors (`Operation not permitted`).

`seatbelt::user_temp()` already correctly resolves `_CS_DARWIN_USER_TEMP_DIR` independently of external `TMPDIR`. `Profile::text()` grants metadata access to ancestors using `ancestors().skip(1)`, which omits the Darwin temp directory itself. The existing prefix grant covers `temp/xcrun_db*` children. When workspace/scratch are elsewhere, neither supplies the missing parent metadata permission indirectly.

`native/core/src/sandbox/seatbelt.rs` now adds exactly:

```scheme
(allow file-read-metadata (literal "<canonical Darwin user temp directory>"))
```

It adds no directory listing, general temp-file content access, or general temp write permission. The existing `xcrun_db` prefix exception, read roots, credential masks, writable workspace/scratch and network rules are unchanged.

## Regression and real Seatbelt execution

Added `sandbox::tests::seatbelt_external_workspace_allows_developer_cache_but_not_siblings` in `native/core/src/sandbox.rs`. Both workspace and scratch are explicitly outside Darwin's per-user temp directory. The test uses the external TMPDIR when available and otherwise `/private/tmp`, without mutating process-global environment. This prevents the old implicit ancestor grant from masking the defect on ordinary CI setups.

The test executes the generated profile through real `sandbox-exec` and verifies:

- temp-directory metadata is readable;
- a unique disposable `xcrun_db` fixture can be deleted, created, read and written;
- `git init/status`, `cc --version`, `make --version` and Python execute successfully, without xcrun/xcodebuild/permission diagnostics;
- listing the Darwin temp directory is denied;
- reading contents or metadata, overwriting and deleting a separate private-cache fixture are denied;
- creating an unrelated temp file is denied, and the private-cache sentinel remains intact.

Only uniquely named disposable test fixtures were created in Darwin temp. Workspace, scratch and native build cache were external for this run. Test fixtures are cleaned up.

## Before/after validation

Before the production change, the new regression **failed** on its first assertion: `stat` of the Darwin temp directory returned `Operation not permitted`. This establishes that the test detects the original omission.

After the seven-line production addition:

```sh
cargo test --locked -p shadowcode-core --lib sandbox::tests:: -- --test-threads=4
```

**16 passed, 0 failed, 0 ignored; 669 filtered out.** Both the original developer-tool test and new regression passed. The existing home/credential confinement and network-mode tests also passed. `git diff --check` passed for the changed files.

Rust 1.95.0; `CARGO_HOME=/Volumes/NVME1TB/Development/ShadowCode-toolchain/cargo`; `RUSTUP_HOME=/Volumes/NVME1TB/Development/ShadowCode-toolchain/rustup`; `CARGO_TARGET_DIR=/Volumes/NVME1TB/Development/ShadowCode-build`; `TMPDIR=/Volumes/NVME1TB/sc-tmp`; Cargo/CMake worker limits 4. Existing external CMake and module-cache configuration retained.

Evidence:

- `/Volumes/NVME1TB/Development/ShadowCode-build/silicon-validation/sandbox-temp-baseline.log`
- `/Volumes/NVME1TB/Development/ShadowCode-build/silicon-validation/sandbox-temp-fixed.log`

The fixed log includes pre-existing Linux Flatpak relay compiler diagnostics (`SOCK_CLOEXEC`/`accept4` unavailable on macOS). Its test returns successfully when that helper cannot build; this is not Linux relay execution qualification. The real macOS tests above executed and passed. The full core suite was not rerun by this task.

Changed only `native/core/src/sandbox/seatbelt.rs`, tests in `native/core/src/sandbox.rs`, and this report. No unrelated policy changes, commit or push. Main owns the final application build and broader validation.

## Independent policy review and final core suite

A separate read-only source review found no actionable policy weakening: the
new grant is metadata-only on the escaped, exact canonical Darwin user-temp
directory obtained through `confstr`. Existing xcrun cache, credential,
workspace/scratch and network rules remain unchanged. The reviewer inspected
the real-Seatbelt regression but did not rerun it. Main's subsequent full core
library run passed **677 tests, 8 ignored**, recorded in
`reports/native-core-lib-final.log`. Ignored tests are not counted as passes.
