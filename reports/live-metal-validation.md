# Live local runtime qualification on Apple Silicon

2026-11-11. **Passed the bounded real-model lifecycle and the intentional failure cleanup exercise.** This is a single-run service integration qualification, not a performance benchmark or coding-quality assessment.

## Inputs and isolation

- Native ARM64 Mac18,5; 25,769,803,776 bytes installed RAM (24 GiB). Runtime discovery reported `MTL0: Apple M6`, 18,186 MiB recommended device memory. That is shared-memory/device guidance, not an independent VRAM bank. Initial catalog estimated 5,693,259,776 bytes available. Other jobs were active; initial load averages were 14.19 / 10.63 / 9.46.
- Repository runtime: `/Users/shadowfetch/Projects/ShadowCode/packaging/llama.cpp/bin/llama-server`; build log confirms pinned `18f9f7bef960b76b693d8dcbb33cbbd6148c1631`, runtime reports `0.4.1-dev`, commit `18f9f7b`, support `metal+cpu`. No installation to the user profile.
- Explicit model: external `silicon-validation/models/Qwen3-0.6B-Q8_0.gguf`, 639,446,688 bytes. The example independently verified SHA-256 `9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031` against the adjacent provenance JSON. Supplied provenance identifies [official Qwen source at revision 23749fefcc72300e3a2ad315e1317431b06b590a](https://huggingface.co/Qwen/Qwen3-0.6B-GGUF/tree/23749fefcc72300e3a2ad315e1317431b06b590a), Apache-2.0; this run did not independently re-audit licensing.
- Fresh temporary profile/workspace on external `TMPDIR`; offline configuration, CLI agents disabled. No user profile/settings changes, model downloads, task execution, or model file modifications.

## Reusable example and bounds

Added only `native/core/examples/qualification_local_lifecycle.rs` and this report for this task. The previously completed cancellation files remain intact; other contributors' files were preserved.

The example calls real service endpoints for catalog, load, one short model test, same-model reuse, unload, and reload. It verifies process/lease state after each relevant transition, then always attempts engine shutdown and an independent runtime stop, including when a step fails or the lifecycle times out. Ctrl-C also enters cleanup. The optional `--fail-after-load` deliberately exercises failure after creating a real child and is expected to exit nonzero.

Bounds: model <= 1 GiB; context cap 4096; response deadline 45 seconds; lifecycle deadline 150 seconds; shutdown 20 seconds; fallback stop 5 seconds; PID disappearance waits 3 seconds per observed child; Tokio shutdown wait 5 seconds. The execution wrapper additionally imposed 210 seconds including checksum/setup, then Ctrl-C with a 35-second cleanup allowance before forced termination. No deadline was reached. Arbitrary process termination/power failure is not claimed to execute asynchronous cleanup.

## Observed results

| Stage | Observation |
| --- | --- |
| Catalog | 333 ms; compatible explicit model; runtime ready |
| Initial load | 617 ms; owned PID 68308; zero leases after endpoint returned |
| Real `/api/models/test` | 190 ms dispatch / 186 ms endpoint latency; reply **“I can respond to your message.”**; reported 22 prompt + 8 completion tokens |
| Same-model load | 5 ms; identical PID, port and start timestamp; zero leases |
| Unload | 20 ms; PID 68308 absent, no loaded snapshot, zero leases |
| Reload | 414 ms; fresh start and PID 68311; zero leases |
| Final cleanup | 37 ms; both recorded PIDs absent, no loaded snapshot, zero leases |

Lifecycle including cleanup: 1,620 ms, excluding checksum validation/profile setup and runtime teardown. These are observations from one debug-build run under concurrent host work, without controlled warm/cold caches, thermal state, power mode or repeated samples.

Loaded provenance reported requested/reported context **4096/4096**, backend **metal**, requested/launch GPU mode **all/all**, and **no CPU fallback**. The new memory policy was active: `apple_shared_memory=true`, `host_prompt_cache_limit_mib=0`, estimated active bytes **1,914,515,104**. The real pinned server accepted the policy and completed inference. This does not measure peak memory or cache behavior across conversations.

**Metal limit:** device discovery and requested placement are established. The service's `reported_backend` field derives from discovery; this example does not expose the child's per-layer offload log. Confirmed Metal layer offload is therefore **not claimed**.

Failure exercise: catalog 350 ms; load 425 ms; deliberately failed before inference; expected exit code 1; cleanup 28 ms, PID 68564 absent, no loaded snapshot and zero leases. Both temporary roots were independently checked absent after process exit. No inference subprocess remained from these runs.

## Reproduction and evidence

Build passed with Rust 1.95.0 and no compiler errors:

```sh
export CARGO_HOME=/Volumes/NVME1TB/Development/ShadowCode-toolchain/cargo
export RUSTUP_HOME=/Volumes/NVME1TB/Development/ShadowCode-toolchain/rustup
export CARGO_TARGET_DIR=/Volumes/NVME1TB/Development/ShadowCode-build
export TMPDIR=/Volumes/NVME1TB/sc-tmp
export CARGO_BUILD_JOBS=4 CMAKE_BUILD_PARALLEL_LEVEL=4
export CLANG_MODULE_CACHE_PATH="$CARGO_TARGET_DIR/clang-module-cache"
export PATH="$CARGO_HOME/bin:/Volumes/NVME1TB/Development/ShadowCode-toolchain/build-tools/cmake/data/bin:$PATH"
cargo build --locked -p shadowcode-core --example qualification_local_lifecycle
"$CARGO_TARGET_DIR/debug/examples/qualification_local_lifecycle"   "$CARGO_TARGET_DIR/silicon-validation/local-lifecycle-new.json"   /Users/shadowfetch/Projects/ShadowCode/packaging/llama.cpp/bin/llama-server   "$CARGO_TARGET_DIR/silicon-validation/models/Qwen3-0.6B-Q8_0.gguf"
```

Use a fresh report path; the example refuses to overwrite an existing report. Append `--fail-after-load` for the intentional failure exercise. Run from the repository root; keep the external environment and avoid concurrent Cargo builds. The Python watchdog used for these observations is described above and is separate from the example's internal lifecycle limits.

External evidence directory: `/Volumes/NVME1TB/Development/ShadowCode-build/silicon-validation/`:

- `local-lifecycle.json` and `.log`: successful run, full safe loaded provenance, model identity, response and step timings.
- `local-lifecycle-failure-cleanup.json` and `.log`: expected failure with successful cleanup.
- `local-lifecycle-verification.json`: independent PID/temp removal checks, host identity, example and evidence SHA-256 values.
- `llama-build.log`: supplied pinned runtime build/device-probe evidence.

`git diff --check` passed. The qualification build and both live runs are finished. Main has taken Cargo for the full core library suite (including the `review::tests` regression) and final packaged development app build; those pending results are outside this report. No further Cargo commands were run by this qualification task. No commit or push. This does not qualify GUI cancellation, large models, memory-pressure behavior, sustained inference, tool use/coding accuracy, release packaging, or confirmed Metal offload.


> Later integration results are recorded in [the implementation and qualification record](../docs/MAC_FLAGSHIP_UPGRADE.md) and [the final resolution](final-integration-resolution.md). Historical test counts and pending statements in this report describe its own source snapshot.
