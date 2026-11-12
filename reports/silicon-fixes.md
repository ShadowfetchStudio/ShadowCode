# Apple Silicon runtime fixes and ARM64 validation

2026-11-11 · Baseline `82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0` · branch `cursor/apple-silicon-t3-ux-610c`.

## Changes

Only authored implementation/test changes: `native/core/src/local_engine.rs`, `native/core/src/local_runtime.rs`, `native/core/tests/local_engine.rs`; this report is the fourth owned file. Concurrent UI changes were preserved. No commit or push.

- **R1 — Mac accounting:** remove speculative pages from the additional sum because XNU already includes them in free pages. Keep saturating byte conversion; describe the result as estimated reclaimable memory.
- **R2 — shared-memory admission:** positively identify Apple Metal devices from existing discovery; immediately before each new child allocation, require the active model/context/projector estimate to fit fresh estimated available memory minus the existing 2 GiB reserve. This also checks CPU retries on identified Apple shared hardware, after the prior child exits. Reuse does not allocate again. Unknown/zero or inconsistent telemetry permits loading. CPU-only, unidentified and discrete GPU runtimes retain existing admission behavior. No context is silently reduced.
- **R3 — explicit bounded host prompt cache:** pass `--cache-ram 0` only for identified Apple shared hardware when the runtime reports the audited `18f9f7bef960b76b693d8dcbb33cbbd6148c1631` revision (or a matching prefix of at least seven characters). This disables the extra host prompt cache, leaving active KV untouched. Other runtime revisions keep existing arguments. Loaded provenance records the policy and active-memory estimate.
- **R4 — cancellation boundary:** prioritize cancellation/unload while awaiting health and properties, reap the child, and recheck cancellation before publishing the loaded server/lease. This supports the UI's existing unload-based Cancel loading action.

## Meaningful checks

Run on native macOS ARM64 with Rust 1.95.0:

| Command | Result |
| --- | --- |
| `cargo test --locked -p shadowcode-core --lib local_ -- --test-threads=4` | 60 passed, 0 failed, 3 ignored; 620 filtered out |
| `cargo test --locked -p shadowcode-core --test local_engine -- --test-threads=4` | 33 passed, 0 failed, 3 ignored |
| `cargo build --locked -p shadowcode-desktop --bin shadowcode` | Successful debug desktop/CLI build |
| `git diff --check` | Passed |

New checks cover speculative accounting at 4/16 KiB page sizes and overflow; insufficient/exact headroom boundaries and unknown/discrete exceptions; cache revision selection and exact argv for All/Auto/Off GPU modes; and eight cancellation scenarios (health/properties × task cancel/unload × response held/released). Cancellation tests assert prompt completion, dead child, no published model, zero leases, and successful retry. Existing GPU failure/CPU fallback integration tests passed. Ignored tests require live downloads or real models; this was the targeted native suite, not every native test.

## Build and executable evidence

All native cache/build state is external. Environment: `CARGO_HOME=/Volumes/NVME1TB/Development/ShadowCode-toolchain/cargo`, `RUSTUP_HOME=/Volumes/NVME1TB/Development/ShadowCode-toolchain/rustup`, `CARGO_TARGET_DIR=/Volumes/NVME1TB/Development/ShadowCode-build`, `TMPDIR=/Volumes/NVME1TB/sc-tmp`; Cargo/CMake worker limits both 4. Rust tools were added to command PATH. Missing CMake 4.4.4 was installed only into external `ShadowCode-toolchain/build-tools`, without profile installation.

Current UI sources were built with Vite into `ShadowCode-build/silicon-validation/ui-dist`; the desktop build embedded that snapshot through a `TAURI_CONFIG` frontendDist override. No repository UI/config edits were needed. Vite reported chunk-size and mixed static/dynamic import warnings, with no build error; this was not a separate TypeScript or browser test.

Executable: `/Volumes/NVME1TB/Development/ShadowCode-build/debug/shadowcode`.

`file` and `lipo -archs`: **Mach-O 64-bit arm64**. `--version`: **ShadowCode 2.4.0**.

SHA-256: `a867ed0287b99618bf554b3af2f1566fe7ddaef7ad8fedb0e0b6e1d305b1d374`.

CLI `status`, `health` and parameterized read-only `sqlite` all exited 0 with empty stderr, using isolated external profile/workspace `/Volumes/NVME1TB/sc-tmp/silicon-32s2ka0o`. Parsed results verified the selected fixture workspace, empty jobs, Rust runtime/version, and SQLite row `arm64, 42`. Health reports native engine OK and model provider unconfigured; no inference was attempted. Build log and JSON smoke evidence: `/Volumes/NVME1TB/Development/ShadowCode-build/silicon-validation/`.

## Limits and provenance

Headroom remains a heuristic, not OS memory-pressure notification, a reservation, or an allocator guarantee. Apple classification depends on successful existing runtime discovery; a CPU-only runtime on Apple hardware is deliberately unchanged. Host cache zero does not bound SWA/recurrent checkpoints or every transient allocation. Unknown runtime revisions receive no new cache flag. Disabling cross-prompt caching can increase prompt-processing latency; no real-model latency/footprint benchmark was run. Cancellation does not promise zero latency after the final publication check.

No real models were executed/downloaded. No GUI interaction, release optimization, .app/DMG packaging, signing or notarization was validated. Cargo and smoke subprocesses are finished.

Research basis: [detailed prior audit](../research_notes/ShadowCode%20Mac%20flagship%20upgrade/silicon-runtime.md), [Apple XNU counters](https://github.com/apple-oss-distributions/xnu/blob/main/osfmk/mach/vm_statistics.h), [Apple unified-memory capability](https://developer.apple.com/documentation/metal/mtldevice/hasunifiedmemory), [pinned runtime defaults](https://github.com/ggml-org/llama.cpp/blob/18f9f7bef960b76b693d8dcbb33cbbd6148c1631/common/common.h#L626-L632), [pinned host cache implementation](https://github.com/ggml-org/llama.cpp/blob/18f9f7bef960b76b693d8dcbb33cbbd6148c1631/tools/server/server-context.cpp#L1597-L1655).


> Later integration results are recorded in [the implementation and qualification record](../docs/MAC_FLAGSHIP_UPGRADE.md) and [the final resolution](final-integration-resolution.md). Historical test counts and pending statements in this report describe its own source snapshot.
