# Apple Silicon runtime performance and robustness

## 1. What concrete defects and gaps remain in the current ShadowCode runtime?

### Takeaway

Prioritize accurate Mac memory accounting, an explicit prompt-cache allowance, and cancellation at the readiness boundary. The current implementation already supports Metal, serial local-model scheduling, bounded startup, runtime leases, crash observation, and inference timing; a replacement inference stack is not a prerequisite for improving Mac robustness. [Runtime](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/native/core/src/local_runtime.rs#L468-L799), [timing](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/native/core/src/models.rs#L241-L248).

### Cited Findings

#### Audit identity and limits

- Audit date: **November 11, 2026**. Read the requested researcher guidance first. Initial read-only Git checks established branch `cursor/apple-silicon-t3-ux-610c`, full HEAD `82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0`, and an empty tracked/untracked status listing. Source references below are pinned to that commit, even if other contributors subsequently change the working tree. [Audited tree](https://github.com/ShadowfetchStudio/ShadowCode/tree/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0).
- The source pin is **llama.cpp `18f9f7bef960b76b693d8dcbb33cbbd6148c1631`**. The pin's `backend=vulkan+cpu` is not evidence that Mac lacks Metal: the Darwin build branch explicitly uses Metal and produces its own generated runtime manifest. [Pin](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/tools/llama.cpp.pin#L1-L5), [Darwin build](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/scripts/build-llama.cpp.sh#L215-L232), [generated manifest](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/scripts/build-llama.cpp.sh#L185-L194).
- Evidence levels: **confirmed code defect** means a specific contradictory calculation/control-flow path is present; **confirmed gap** means a capability or policy is absent from the audited path; **inference** means likely operational impact requiring measurement. No actual out-of-memory event, model throughput, thermal behavior, or cancellation latency was measured in this audit. Deterministic arithmetic/source checks are recorded below, not represented as native integration tests.

#### R1 — P2, confirmed Mac accounting defect: speculative pages counted twice

**Location:** `native/core/src/local_engine.rs:850–883`, especially **879–882**. `available_memory()` adds `free_count + inactive_count + speculative_count + purgeable_count`. Apple's definition of `vm_statistics64` explicitly includes speculative pages in `free_count`; adding them again inflates the reported estimate. [ShadowCode calculation](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/native/core/src/local_engine.rs#L850-L883), [Apple XNU definition](https://github.com/apple-oss-distributions/xnu/blob/main/osfmk/mach/vm_statistics.h).

**Impact:** the inflated value is exported as `hardware.available_bytes` and feeds the current low-memory warning. It can suppress that warning. It does **not** presently increase `plan_context` directly, because that function ignores available memory. [Hardware export](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/native/core/src/local_engine.rs#L994-L1003), [warning](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/native/core/src/local_engine.rs#L1248-L1255), [planner](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/native/core/src/local_engine.rs#L1040-L1085).

**Bounded fix proposal:** remove the duplicate speculative term, isolate counter interpretation into a pure helper, and describe the result as estimated reclaimable/headroom memory rather than an allocation guarantee. This does not establish that all inactive or purgeable pages are immediately reclaimable or mutually exclusive; validate those semantics separately. Do not merely clamp to installed RAM and hide the error.

**Regression proposal:** synthetic `free=100`, `inactive=200`, `speculative=25`, `purgeable=0`, page size `16384`: current expression yields **5,324,800 bytes**; removing the duplicate yields **4,915,200 bytes**, a **409,600-byte overstatement**. Repeat at 4096-byte page size, zero counters, failed syscalls, and large counters. The existing test only checks a live value is positive and no larger than installed RAM, so it does not test the formula. [Existing test](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/native/core/src/local_engine.rs#L2077-L2083).

#### R2 — P1, confirmed budget-policy gap: capacity is treated as readiness under unified-memory pressure

**Locations:** `local_engine.rs:1014–1085`, `1248–1267`, `1877–1883`; `local_runtime.rs:704–751`.

`Budget::from_runtime` records GPU **total** bytes and system RAM, while `plan_context` tries GPU total minus 1 GiB and then installed RAM minus 2 GiB. Available memory is only used to append a warning; the entry still returns `ready`. An existing test explicitly expects that behavior when available memory is only 1 MiB. This is an intentional present policy with a significant robustness gap, not an overlooked existing admission check. [Budget and planner](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/native/core/src/local_engine.rs#L1014-L1085), [readiness](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/native/core/src/local_engine.rs#L1248-L1267), [test encoding policy](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/native/core/src/local_engine.rs#L2085-L2113).

The planner does **not** literally add RAM and VRAM together; do not report that nonexistent arithmetic bug. Its actual problems are capacity-versus-current-headroom semantics, missing explicit topology, and treating CPU retry as an available recovery path without a shared-pool pressure check. On Apple Silicon the CPU and GPU share physical memory. The pinned Metal backend reports `recommendedMaxWorkingSetSize` as total and subtracts `currentAllocatedSize` for free; those values are not an independent VRAM bank or a system-wide free-memory reservation. [Apple unified memory](https://developer.apple.com/documentation/metal/mtldevice/hasunifiedmemory), [Apple working-set guidance](https://developer.apple.com/documentation/metal/mtldevice/recommendedmaxworkingsetsize), [pinned Metal implementation, get_memory](https://github.com/ggml-org/llama.cpp/blob/18f9f7bef960b76b693d8dcbb33cbbd6148c1631/ggml/src/ggml-metal/ggml-metal-device.m#L1487-L1496).

The fallback path retries on CPU after an allocation failure even if classified `Memory::System`, provided GPU mode was not Off and fallback is allowed. That may help a backend-specific failure; it does not create more physical memory on an Apple Silicon Mac. Generic allocation failures in a GPU launch can also be classified as GPU shortages, so diagnostics are not always proof of an independent GPU constraint. [Fallback](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/native/core/src/local_runtime.rs#L696-L751), [classification](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/native/core/src/local_runtime.rs#L304-L358).

**Bounded fix proposal:** separate structural compatibility/capacity from load admission. Add a typed hardware snapshot with unified/discrete/unknown topology, installed RAM, estimated headroom, OS pressure, timestamp, and Metal recommended working set. Recheck before a new allocation and before CPU retry. Under critical pressure, defer the load and suggest a smaller context/model; under warning pressure, offer a lower-memory plan explicitly. Do not change a running task's context silently. Treat unknown telemetry as unknown, not zero available bytes. Use `hasUnifiedMemory` or equivalent verified capability rather than `cfg!(macos)` to classify discrete Intel/AMD Macs.

**Regression proposal:** injected budget for a 16 GiB Mac, 12 GiB Metal recommended working set, only 2 GiB estimated headroom; 6 GiB weights, 32 layers, 8 KV heads, K/V dimensions 128, context 16384. The current estimator gives **8.75 GiB** and the planner accepts GPU placement against an 11 GiB target. Test the new admission decision separately from that capacity result. Add Metal device failure with normal pressure (CPU retry allowed), system shortage with critical pressure (no immediate duplicate allocation), and unknown-pressure cases. This fixture is synthetic; it is not a prediction for a named real model.

#### R3 — P1, confirmed steady-state budget gap: prompt-cache storage is unaccounted for

**Locations:** `local_runtime.rs:817–846`; `gguf.rs:410–512`, especially `487–503`.

The launch does not pass `--cache-ram` or context-checkpoint limits. The **pinned** upstream defaults include `cache_ram_mib=8192` and `n_ctx_checkpoints=32`. The cache is allocated on demand, not all at startup. Upstream saves an existing prompt when selecting an unrelated/LRU slot or losing much of its useful prefix, including when only one slot exists. Thus `--parallel 1` is not a guarantee of only one resident KV representation over a conversation-switching workload. [ShadowCode argv](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/native/core/src/local_runtime.rs#L817-L846), [upstream defaults](https://github.com/ggml-org/llama.cpp/blob/18f9f7bef960b76b693d8dcbb33cbbd6148c1631/common/common.h#L626-L632), [upstream cache allocation and use](https://github.com/ggml-org/llama.cpp/blob/18f9f7bef960b76b693d8dcbb33cbbd6148c1631/tools/server/server-context.cpp#L1597-L1655).

ShadowCode estimates weights, one context's KV, a compute allowance, projector, and fixed overhead of 512 MiB plus an image allowance. It has no separate prompt-cache or checkpoint budget. This is a concrete discrepancy with the launched runtime's possible memory usage, especially relevant on smaller unified-memory Macs. It does **not** prove every session uses an additional 8 GiB. [Estimator](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/native/core/src/gguf.rs#L410-L512), [upstream cache/checkpoint setup](https://github.com/ggml-org/llama.cpp/blob/18f9f7bef960b76b693d8dcbb33cbbd6148c1631/tools/server/server-context.cpp#L1351-L1369).

**Bounded fix proposal:** add an explicit prompt-cache budget to the launch plan, argv, estimate, and provenance. A first conservative policy can disable the host prompt cache for a constrained-memory profile, or use a measured small cap; preserve the active context cache. Validate flags against the resolved runtime because configured external binaries can differ from the shipped pin. Checkpoints for recurrent/SWA state require separate accounting; setting `--cache-ram 0` does not establish a bound on every other state allocation.

**Regression proposal:** assert explicit argv and launch identity for cache allowance; fake-server tests record and verify the value. On a qualified Mac, alternate several long, unrelated chats on one loaded model and record child footprint, pressure, swap growth, cache allocation logs, first-token latency, and return-to-idle behavior. Compare disabled versus bounded cache to quantify the memory/latency tradeoff. Include an SWA/recurrent model because upstream checkpoints are conditional on memory rollback capabilities/SWA, not universally full KV copies. [Checkpoint conditions](https://github.com/ggml-org/llama.cpp/blob/18f9f7bef960b76b693d8dcbb33cbbd6148c1631/tools/server/server-context.cpp#L3460-L3473).

#### R4 — P2, confirmed cancellation race: successful readiness can bypass Stop

**Locations:** `local_runtime.rs:1027–1056`, `1097–1141`, publication at `666–678`.

The health request is awaited outside the cancellation `select!`. If it succeeds, execution breaks out of the loop and awaits `/props`, also outside cancellation selection. There is no cancellation/abort recheck after `/props` and before returning `Server`, and acquisition publishes that server/lease. Therefore a token cancelled during a delayed successful health or props response can still produce a successful acquisition. The 2-second HTTP timeout bounds each request but does not fix the ordering error. [Readiness path](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/native/core/src/local_runtime.rs#L994-L1056), [successful return](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/native/core/src/local_runtime.rs#L1097-L1141), [publication](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/native/core/src/local_runtime.rs#L663-L678).

**Bounded fix proposal:** make health and props awaits cancellation-aware, check both cancellation tokens before returning/publishing the successful load, and stop/reap the owned child on every cancellation path. Document the publication linearization point: cancellation before it must win; cancellation after it belongs to the task lifecycle. Retain the current process ownership and group cleanup rather than using a port or PID search to kill something.

**Regression proposal:** add fake-server barriers for `/health` and `/props`. Wait until the request is received, cancel the task or call unload, then release a successful response. Assert cancelled acquisition, no loaded snapshot, no leaked lease, and child termination. Repeat cancellation immediately before publication, while another model holds a lease, and while the slot mutex is busy. The current slow-load test cancels during a not-ready interval and does not exercise successful readiness crossing cancellation. [Current cancellation regression](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/native/core/tests/local_engine.rs#L1771-L1808).

#### R5 — P2, confirmed Settings interaction gap: manual load has no reachable cancel action

**Locations:** `ui/src/components/settings/LocalModelsPage.tsx:75–94`, `181–195`, `439–466`; `native/core/src/service/model_catalog.rs:85–108`.

Manual load sets `pending`; Unload is disabled while pending, and the loading row remains a disabled Load button. With no previous loaded model there is no top-level Unload button at all. The route creates a fresh cancellation token rather than tying the request to a frontend cancellation handle. The runtime's unload operation can abort an in-progress load, but this page provides no usable control for that state. [UI action lifecycle](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/ui/src/components/settings/LocalModelsPage.tsx#L75-L94), [Unload rendering](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/ui/src/components/settings/LocalModelsPage.tsx#L181-L195), [Load rendering](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/ui/src/components/settings/LocalModelsPage.tsx#L439-L466), [route](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/native/core/src/service/model_catalog.rs#L85-L108).

**Bounded fix proposal:** render an enabled **Cancel loading** action associated with the pending load, separate from normal button disabling. Prefer operation IDs and operation-scoped cancellation so a stale UI action cannot abort somebody else's newly started load. A smaller interim change can expose the existing abort operation only while the UI still owns that pending load, after fixing R4. Cancelling the browser fetch alone is not proof the backend stopped.

**Regression proposal:** hold a load promise open; verify Cancel loading remains keyboard-accessible and enabled, fires the cancellation request once, waits for authoritative cancellation, and does not show a loaded success toast afterward. Repeat with no loaded model, an old idle model being replaced, route changes, and an active unrelated lease.

#### R6 — P2, confirmed observability gap: discovered Metal is reported as effective execution

**Locations:** `local_engine.rs:484–499`; `local_runtime.rs:1108–1112`, `1133`; `LocalModelsPage.tsx:147–148`, `175–177`.

For every successful non-Off launch, `Loaded.backend` copies `spec.backend`, which came from device discovery. Auto mode passes no explicit offload count. Nothing in this path validates effective offloaded layers or partial/all-CPU execution; the UI consequently presents discovery as loaded execution. A successful Auto launch with zero offloaded layers would still carry the discovered backend label. That scenario is an inference requiring a controlled runtime fixture; the provenance mismatch is directly visible in code. [Discovery](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/native/core/src/local_engine.rs#L484-L499), [loaded label and provenance](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/native/core/src/local_runtime.rs#L1108-L1134), [argv](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/native/core/src/local_runtime.rs#L841-L845), [UI](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/ui/src/components/settings/LocalModelsPage.tsx#L139-L177).

**Bounded fix proposal:** keep separate fields for detected capabilities, requested placement, actual launch flags, and observed placement. Until the pinned runtime supplies a trustworthy observation, say **Metal requested; execution unverified**. Capture bounded, version-aware allocation/offload observations during startup rather than hoping the rolling stderr tail still contains them. Additive API fields should retain an unknown state for external runtimes.

**Regression proposal:** discovered Metal with reported zero/partial/all GPU layers; CPU fallback; missing observations; old runtime; malformed observations. Verify the UI and comparison evidence cannot claim confirmed Metal throughput from detection alone.

#### Current support that must not be rediscovered as missing

- Metal device IDs `MTL0` map correctly to `metal`; `GGML_METAL_PATH_RESOURCES` points at the runtime's adjacent shaders. Darwin builds request Metal, copy `.metallib` files, and detect a Rosetta shell to build arm64. [Detection and environment](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/native/core/src/local_engine.rs#L484-L541), [build](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/scripts/build-llama.cpp.sh#L219-L232), [shader copying](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/scripts/build-llama.cpp.sh#L322-L340).
- Context planning already considers trained context, configured cap, model/projector bytes, and metadata-derived KV costs. It limits the server to one slot and rejects a reported context mismatch. Missing `n_ctx` remains accepted and represented as null in provenance; stronger confirmation for the pinned runtime is a possible follow-up, not a claim that no checking exists. [Planner](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/native/core/src/local_engine.rs#L1040-L1085), [context check](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/native/core/src/local_runtime.rs#L1074-L1085).
- Lease waiting already registers notifications before inspecting state, supports cancellation, and prevents model replacement while another task holds the server. CPU fallback is explicitly disallowed for strict comparisons. Runtime crash observation clears the loaded snapshot. [Lease and comparison policy](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/native/core/src/local_runtime.rs#L595-L655), [crash observation](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/native/core/src/local_runtime.rs#L487-L523).
- Mac parent-death protection exists: a kqueue watcher kills the child if ShadowCode exits. Do not infer a missing Mac implementation from the module comment mentioning Linux PDEATHSIG. [Mac process watcher](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/native/core/src/process.rs#L160-L233).
- The cold-catalog selection defect from prior work is already addressed using `entry_for_id` against the configured catalog and has a regression. It is not a new finding. [Current selection](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/native/core/src/service/model_catalog.rs#L166-L178), [current regression](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/native/core/tests/local_engine.rs#L796-L825).

### Inferences

- R2 and R3 together are a plausible source of “loads successfully, later slows dramatically” on a small Mac: the initial capacity result does not bound dynamic host caches or evolving memory pressure. Actual swap growth and latency must be measured before claiming this occurred in ShadowCode.
- R4 and R5 are complementary fixes: exposing Cancel loading without repairing the readiness race can still yield a late success. Fix the backend ordering first or in the same reviewed change.
- Correcting labels alone will not improve inference speed, but it is necessary to make subsequent benchmark comparisons defensible.

### Gaps

No production implementation, tests, configuration, dependencies, or installed runtimes were modified. No Cargo build/test, model load/download, memory-pressure generator, sysctl change, or benchmark was run. The user subsequently reported only 4 GB local free space and no `rustc` in PATH or `~/.cargo`; these are constraints supplied by the user, not independently remeasured. The external volume's reported 378 GB is for future build-cache planning. Native execution and hardware qualification remain outstanding.

## 2. What do official Apple, llama.cpp, and MLX sources establish?

### Takeaway

Treat shared physical capacity, Metal working-set guidance, live pressure, context allocation, and active computation as different quantities. Keep llama.cpp/Metal as the current production baseline; consider MLX only through a separately measured backend experiment with explicit model-format and lifecycle support.

### Cited Findings

#### Unified memory, working set, pressure, and thermal state

- Apple exposes `hasUnifiedMemory` to distinguish shared CPU/GPU memory from dedicated GPU memory. This is a topology property; it is not a free-memory counter. [Apple API](https://developer.apple.com/documentation/metal/mtldevice/hasunifiedmemory).
- `recommendedMaxWorkingSetSize` is approximate performance guidance, not a promise that an allocation succeeds or a second bank of installed RAM. The pinned llama.cpp Metal backend uses it when reporting device total memory. [Apple API](https://developer.apple.com/documentation/metal/mtldevice/recommendedmaxworkingsetsize), [pinned implementation](https://github.com/ggml-org/llama.cpp/blob/18f9f7bef960b76b693d8dcbb33cbbd6148c1631/ggml/src/ggml-metal/ggml-metal-device.m#L1487-L1496).
- Apple supplies a dispatch source for changes in system memory pressure and a separate thermal-state property. A host free-page estimate is not a substitute for either. No corresponding pressure/thermal event path was found in the audited runtime/UI source searches; the current runtime state is primarily load/lease/error based. [Memory pressure](https://developer.apple.com/documentation/dispatch/dispatchsourcememorypressure), [thermal state](https://developer.apple.com/documentation/foundation/processinfo/thermalstate-swift.property), [runtime state](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/native/core/src/local_runtime.rs#L278-L287).

#### Context/KV is an allocation policy, not just model file size

- ShadowCode's f16 KV estimate is essentially the sum over layers of `KV heads × (K dimension + V dimension) × 2 bytes × cached tokens`, with per-layer/SWA handling. Compute scratch is a clamped heuristic; defaults substitute for missing metadata. This is useful for planning but cannot certify architecture-specific recurrent state, allocator padding, or real peak memory. [Estimator](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/native/core/src/gguf.rs#L425-L503).
- The pinned server documents separate logical batch, physical microbatch, K/V cache types, Flash Attention, and fitting controls. Its defaults include batch 2048, microbatch 512, f16 K/V, and Flash Attention auto. ShadowCode leaves these unset, so explicitly configuring them must be version-aware and measured; “enable Flash Attention” is not evidence of a missing default optimization. [Pinned server options](https://github.com/ggml-org/llama.cpp/blob/18f9f7bef960b76b693d8dcbb33cbbd6148c1631/tools/server/README.md), [current launch args](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/native/core/src/local_runtime.rs#L817-L846).
- The pinned server's fit policy adjusts **unset** parameters. ShadowCode explicitly sets context, and All mode explicitly sets `-ngl 999`; do not assume upstream fitting will automatically reduce that context or chosen offload count. A revised plan must preserve the existing engine/server context agreement. [Pinned fit documentation](https://github.com/ggml-org/llama.cpp/blob/18f9f7bef960b76b693d8dcbb33cbbd6148c1631/tools/server/README.md), [launch](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/native/core/src/local_runtime.rs#L817-L846), [agreement](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/native/core/src/local_engine.rs#L1864-L1874).

#### Metal versus CPU, and fair performance measurement

- The official llama-bench supports separate prompt-processing, token-generation, and combined tests, repeated runs, batch/microbatch sweeps, context-depth controls, thread counts, offload counts, and structured output. These provide an appropriate primitive benchmark alongside actual ShadowCode task measurements. Its numbers are not inherently end-to-end application latency. [Pinned llama-bench documentation](https://github.com/ggml-org/llama.cpp/blob/18f9f7bef960b76b693d8dcbb33cbbd6148c1631/tools/llama-bench/README.md).
- Existing application measurements already distinguish task queue/load/model-request/tool phases, and capture runtime-reported prompt/generation token counts and milliseconds. Preserve that distinction; add first-token latency and resource observations rather than replacing these with one tokens-per-second figure. [Task timing](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/native/core/src/timing.rs#L10-L50), [runtime timing capture](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/native/core/src/models.rs#L956-L970).

#### MLX is a distinct implementation choice

- MLX arrays can be accessed by CPU and GPU in one memory pool; execution device is specified for operations without relocating the arrays. That establishes the architecture, not universal performance superiority over llama.cpp. [Official MLX unified-memory guide](https://ml-explore.github.io/mlx/build/html/usage/unified_memory.html).
- MLX separates active, peak, and cached allocator memory. `clear_cache` empties its free allocation cache; this should not be presented as unloading active model weights or deleting a live context. [Memory API](https://ml-explore.github.io/mlx/build/html/python/memory_management.html), [clear_cache](https://ml-explore.github.io/mlx/build/html/python/_autosummary/mlx.core.clear_cache.html).
- The current official `set_memory_limit` documentation describes a guideline and a default of 1.5 times the device recommended working set when Metal is available, not a strict physical-memory admission cap. `set_wired_limit` controls residency, is useful on macOS 15+, and must stay below total memory. Automatically raising system wired-memory limits is not a justified product fix for pressure. [Memory limit](https://ml-explore.github.io/mlx/build/html/python/_autosummary/mlx.core.set_memory_limit.html), [wired limit](https://ml-explore.github.io/mlx/build/html/python/_autosummary/mlx.core.set_wired_limit.html).
- MLX-LM documents rotating KV caches, prompt caching, and configurable prefill step size; reducing rotating-cache size trades memory for quality, and smaller prefill steps trade peak memory for processing speed. Its generation implementation also exposes optional KV quantization and synchronizes before restoring a temporary wired limit. These are separate policies that require task-quality and lifecycle tests. [Official MLX-LM README](https://github.com/ml-explore/mlx-lm/blob/main/README.md#long-prompts-and-generations), [generation implementation](https://github.com/ml-explore/mlx-lm/blob/main/mlx_lm/generate.py).
- The current managed local-engine path is GGUF plus a llama-server launch and an HTTP client. An MLX experiment requires its own model resolution, process/worker lifecycle, capability reporting, and provenance; it is not a Metal toggle on the existing launch. [Managed preparation](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/native/core/src/local_engine.rs#L1775-L1911), [MLX-LM project](https://github.com/ml-explore/mlx-lm).

#### Cancellation is not unloading, and unloading is not proof of instant physical reclamation

- Model HTTP requests and normal response streaming select on cancellation. The error-body diagnostic path separately waits up to five seconds without a cancellation selection. That is another bounded responsiveness improvement, distinct from R4's false-success race. [Request and stream paths](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/native/core/src/models.rs#L643-L715).
- The pinned upstream has disconnect/stop checks and posts cancellation tasks. Dropping the local HTTP stream initiates cancellation through that mechanism; it does not establish that GPU work has stopped at the same instant. Measure cancellation until the server slot is reusable, separately from the UI task reaching its cancelled state. [Upstream response reader](https://github.com/ggml-org/llama.cpp/blob/18f9f7bef960b76b693d8dcbb33cbbd6148c1631/tools/server/server-queue.cpp#L548-L618).
- ShadowCode intentionally keeps the model loaded after a lease ends. Explicit unload refuses active leases and terminates the child; SIGTERM gets up to five seconds before escalation and a further bounded wait. Do not label retained idle model memory a leak without examining this policy. [Lease drop](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/native/core/src/local_runtime.rs#L210-L216), [termination](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/native/core/src/local_runtime.rs#L257-L275), [unload](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/native/core/src/local_runtime.rs#L761-L799).

### Inferences

- Benchmark sustained prefill and decode independently. A configuration that improves steady decode can still hurt first-token latency, interactive responsiveness, or memory pressure.
- An idle-unload policy may be valuable under pressure, but should honor leases and expose the cold-start tradeoff. Pressure events should not silently change an active task's model, context, or execution policy.
- A backend-neutral launch/admission/observation contract is useful before any MLX prototype. Ship the bounded correctness fixes first; use measured evidence to decide whether another backend improves the product.

### Gaps

No official source establishes a universal MLX-over-llama.cpp winner for ShadowCode's tasks. No same-model, same-context, same-quality results were produced here. Official MLX documentation rendered as version 0.32.4 when fetched; its main-branch pages and Apple/XNU main links are moving references, unlike the pinned llama.cpp links. Capture exact upstream revisions for any implementation or published performance study.

## 3. What implementation structure and regression study should follow?

### Takeaway

Make a few bounded corrections first, then build the flagship local-inference UI around an explicit launch plan and observed runtime state. The following is a proposal only; it neither changes production code nor claims measured speed improvements.

### Cited Findings

The current API already exposes useful runtime data, but the frontend `LocalCatalog` type omits native `available_bytes`, fallback details, lease count, and provenance. The Settings page displays RAM/GPU capacity and a loaded backend but has no live pressure model. Additive typed fields can connect the existing native foundation to a more informative interface. [Native hardware fields](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/native/core/src/local_engine.rs#L994-L1003), [native loaded fields](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/native/core/src/local_runtime.rs#L534-L550), [frontend contract](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/ui/src/api.ts#L277-L304).

#### Proposed order of implementation

1. **R1, small correctness fix:** counter helper plus deterministic fixtures. No new UI dependencies.
2. **R4 + R5, bounded lifecycle fix:** cancellation at health/props/publication and a reachable Cancel loading action. Keep operation ownership explicit.
3. **R3, explicit cache policy:** add a bounded host cache allowance with launch identity/provenance and a controlled conversation-switch test.
4. **R2, resource admission:** typed topology/pressure/headroom snapshot, launch-time check, and unified-memory-aware CPU fallback decisions.
5. **R6 and the local-inference panel:** expose detected/requested/observed placement and explain capacity, context allocation, active usage, and pressure separately.
6. **Performance tuning only after baselines:** small batch/microbatch/thread/Flash-Attention/KV-policy sweeps; an optional MLX adapter experiment if it delivers demonstrated quality and latency improvements.

This order is a recommendation based on R1–R6, not an upstream prescription.

#### Proposed structural seams

| Responsibility | Proposed data/behavior | Existing integration point |
|---|---|---|
| Hardware snapshot | topology; installed bytes; estimated headroom; pressure; Metal recommended bytes; sample time and source | `local_engine.rs:961`, `1014` |
| Capacity estimate | weights, active KV, compute allowance, projector, host cache allowance, checkpoint allowance/unknown; confidence and assumptions | `gguf.rs:415`, `425` |
| Launch plan | context, placement, cache budget, supported explicit knobs, selected runtime identity | `local_runtime.rs:49`, `817` |
| Admission | fresh snapshot before new allocation; preserve existing lease reuse; defer under critical pressure | `local_engine.rs:1804`, `local_runtime.rs:587` |
| Runtime observation | actual offload evidence, child footprint, pressure trend, reason for fallback, lifecycle phase | `local_runtime.rs:534`, `1097` |
| Load operation | identifier, cancellation token, progress, terminal state, publication ordering | `service/model_catalog.rs:85`, `LocalModelsPage.tsx:75` |

These are proposed seams around the source paths already cited, not a requirement to split modules immediately. Keep the existing single-runtime ownership and source identity validation.

#### Proposed UI behavior for the Mac flagship work

- Show **Unified memory: 16 GiB installed**, **Metal recommended working set: …**, and **Memory pressure: normal/warning/critical/unknown** as distinct values. Do not present a GPU allocation threshold and RAM as two additive capacities.
- Model cards should distinguish **supported on this Mac** from **safe to load now**, with an estimate breakdown and explicit uncertainty. Offer an actionable smaller-context plan with the changed context visible before the task starts.
- Keep **Cancel loading**, **Stop generation**, and **Unload model** distinct. State that Stop generation normally keeps the model loaded. Do not disable cancellation because a load request is pending.
- Present **requested acceleration** and **observed execution** separately. Expose CPU fallback and why it happened; preserve the strict comparison policy rather than silently comparing different execution modes.
- Extend existing timings with first-token latency and recent memory/pressure observations. Keep app time, runtime-reported processing time, and tokens per second separate. Explain unavailable measurements rather than displaying zero.
- Use status text and accessible controls, not color alone. A pressure warning should explain whether to reduce context, close other workloads, wait, or unload the idle model.

These are product proposals derived from the audited API/UI gaps, not claims that the interfaces already exist.

#### Regression matrix and acceptance criteria

| Test group | Deterministic regression to add | Required observation |
|---|---|---|
| R1 accounting | Apple counter fixtures at 4 KiB/16 KiB page sizes; failed query; high counters | Speculative pages counted once; explicit unknown on failure; no arithmetic overflow |
| R2 admission | Unified/discrete/unknown topology × normal/warning/critical/unknown pressure | Capacity and admission differ; no immediate CPU retry after confirmed shared-pool shortage under critical pressure |
| R3 cache budget | Assert argv/identity/provenance; run same model across unrelated contexts | Cache bounded by policy; model-switch identity changes when policy changes; measure host footprint growth |
| R4 readiness cancellation | Barrier at health, props, and pre-publication; task cancel and unload abort | No success/snapshot/lease after cancellation wins; owned child reaped; next load works |
| R5 load control | Pending load with no prior model and with old idle model | Enabled accessible cancel; no stale success toast; authoritative terminal state |
| R6 observed placement | Metal detected with zero/partial/all offload and unknown evidence | UI and exported evidence preserve detection versus observation |
| Stream cancellation | Cancel before first byte, during prefill, during decode, and during an error body | Measure UI acknowledgement and backend slot reuse separately; no tool execution from partial output |
| Context agreement | Boundary lengths plus malformed/missing runtime `n_ctx` | No silently accepted mismatch; explicit unverified state or refusal policy for absent evidence |
| Pressure after load | Inject pressure transitions while idle, streaming, and another lease is held | No active task surprise replacement; no unload/reload oscillation; recovery after pressure normalizes |
| Isolation | Unrelated loopback listener/process alive during load failure/cancel | Cleanup targets only owned resources |

Preserve existing regressions including `load_switch_lease_unload_and_shutdown_stop_the_server`, `cancel_or_unload_during_provenance_probe_never_launches_a_server`, `managed_jobs_run_in_submission_order_across_projects_and_skip_cancelled_entries`, `gpu_out_of_memory_moves_to_the_cpu_and_says_why`, and the post-ready crash cases. Their presence is not a claim that they were run in this audit. [Current test suite](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/native/core/tests/local_engine.rs).

#### Proposed measured study

**Hardware:** start with the available native arm64 Mac after checking current workloads and disk headroom. Later sample at least a constrained-memory Apple Silicon system and a larger-memory Pro/Max system; record SoC, physical RAM, macOS, power mode/source, thermal state, app/runtime commit, runtime binary hash, model hash, quantization, context, and effective placement. Do not infer all Apple Silicon behavior from one host.

**Workloads:** use a small dense model, a larger model that approaches the actual safe budget, and an SWA/recurrent or MoE model if supported by the pinned runtime. Include 512-token, 4K-token, and safely admitted longer prompts; 128/256-token decode; same-prefix follow-up; unrelated conversation alternation; a tool-schema-heavy task; and cancellation during prefill/decode. Add vision only with a documented compatible projector and its memory allocation.

**Experimental controls:** hold model/tokenizer/template, input, seed/sampling, output length, context, and quality checks constant. Separate process-cold from warm-resident and prompt-cache hits; report cache state rather than claiming OS file cache was cold. Change one policy at a time. Compare Metal and forced CPU only when both configurations are safe to run. Use at least five repetitions per configuration and report median/range or dispersion; reserve p95 claims for enough samples. Keep “settings requested” separate from observed execution.

**Metrics:** queue wait, load time, first-token latency, runtime prompt tokens/sec, runtime decode tokens/sec, total task time, task success/tool correctness, child footprint, host swap delta, pressure transitions, peak measured memory, cancellation-to-UI time, cancellation-to-slot-reuse time, and unload-to-child-exit time. Record measurement scope: process memory and Metal/allocator counters overlap, so do not add them indiscriminately.

**Decision rule proposal:** accept a tuning default only when it improves the target latency/throughput or pressure behavior without unacceptable quality loss or cancellation regressions. Set performance tolerances from measured baseline variance, not an invented universal percentage. A cache policy may intentionally trade warm-prefix speed for much lower memory; expose that decision rather than calling it universally faster.

The existing ignored `live_speed` helper already reads separate prompt and generation speed from llama-server, and the build enables tools but does not ship llama-bench. Reuse the helper and use a separately qualified benchmark binary; do not assume the installed app bundle contains it. [Live speed helper](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/native/core/tests/local_engine.rs#L2312-L2365), [build/install scope](https://github.com/ShadowfetchStudio/ShadowCode/blob/82c60ee6a8bb8174c617d92aae0c8d5b14bc82a0/scripts/build-llama.cpp.sh#L299-L340).

### Inferences

A substantive implementation can ship around the current llama.cpp process model: a resource/admission layer, explicit cache budget, reliable cancel control, and an evidence-aware local-runtime panel. This is more directly supported by the discovered defects than a wholesale backend migration. MLX remains a research candidate; it should earn adoption through the same task-quality, cancellation, footprint, and latency tests.

### Gaps

- Executed checks were read-only source inspection, official-source retrieval, and deterministic Python arithmetic/source assertions. The arithmetic fixtures confirmed the R1 duplicate and the R2 8.75-GiB capacity example. Source assertions confirmed no cancellation check after props, no explicit cache/batch/microbatch/KV-type flags, and backend assignment from the launch spec. These do not substitute for native regression execution.
- No test or benchmark results are claimed. Future builds must respect the reported local-disk constraint and absent compiler. An external Cargo target directory alone does not relocate toolchains, Cargo registry/git caches, temporary files, or model downloads; plan those locations before installing/building. No relocation or installation was performed here.
- This report is the sole intended output of this research task. Other contributors' toolbar/split-view work is outside this audit and must be preserved.
