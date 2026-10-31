# Windows laptop qualification — October 31, 2026

Test machine: Windows 11 Home x64, Ryzen 3 5300U, 32 GB RAM. Baseline:
`9c82cae76d4c94a4416405c93f00e198080a18ac`, Windows CI preview 2.3.0.
Tests use disposable profiles and projects; no vendor credentials are needed.

## Reproduced defects and fixes

- The original installed desktop executable exited with `0xC0000135` on
  the machine before the Microsoft C++ runtime was installed. Stage the
  redistributable x64 CRT from Visual Studio into both the desktop and
  managed-runtime directories, and include it in the NSIS resource map.
- The original managed `llama-server.exe` also exited with `0xC0000135`:
  its imports included OpenSSL DLLs absent from the package. At the pinned
  llama.cpp revision, `LLAMA_CURL=OFF` is obsolete. Set `LLAMA_OPENSSL=OFF`;
  ShadowCode downloads model files and uses loopback HTTP for inference.
- Worktree setup launched `sh` by name. A normal Git for Windows install
  exposes `git` on PATH, not necessarily `sh`. Use the existing platform
  shell selection, keeping the setup job's cancellation and process-tree
  cleanup intact.
- CodeMirror's Windows default redo is Ctrl+Y. Add Ctrl+Shift+Z as an
  additional binding, keeping Ctrl+Y. The live editor tests exercise both.
- The E2E build used a POSIX environment assignment that fails in Windows'
  default npm shell. A small Node launcher now sets the build environment.
- Windows Clippy rejected a dummy unit-valued Unix endpoint cleanup guard.
  Bind and retain that guard only on Unix; Windows continues to release
  named pipes through their handles.
- The unoptimized installed desktop passed `--version`, but `run` exited
  with stack overflow (`0xC00000FD`) before producing an event. Reserve an
  8 MiB main-thread stack for the MSVC desktop target. The installed-runtime
  check now also calls `status` with an isolated profile, exercising the
  async CLI rather than only the argument-parser version fast path.

- Busybox-w32's final external-command path treated an inaccessible parent
  process as a dead parent inside AppContainer. It returned zero before
  Python finished; normal job cleanup then stopped Python, leaving an empty
  tool receipt. Preserve foreground waiting when the launcher supplies its
  sandbox null-device handle. A regression failed with the original binary
  (expected exit 7, received exit 0 and empty output) and passed with the
  patched pinned binary. Keep process-tree cleanup and confinement intact.
- Describe the actual platform sandbox in the exec schema and give explicit
  workspace-relative cwd guidance. Invalid cwd errors now explain how to
  use the project root without weakening path validation.

- A fresh CLI process could not select a configured local GGUF model until
  a picker/catalog read had populated the process-global cache. Selection
  now scans the current profile's configured files before resolving the ID,
  and refuses models removed from that configuration even if cached.

## Regression coverage

`test-windows-installed-runtime.ps1` checks the installed desktop,
`llama-server`, and `llama-cli` with a clean working directory and only
Windows system directories on PATH. It requires the app-local CRT files
and fails on a missing executable, nonzero exit, timeout, or missing version.
Both Windows packaging workflows run it after installation.

Windows CI also runs the editor and Markdown clipboard browser tests.
Windows converts clipboard LF to CRLF; the assertions normalize that OS
representation while retaining full text, blank-line, and content checks.
The worktree unit fixture pins its own Git line-ending configuration, and
the absolute reset-time test uses a UTC reference rather than local noon.
The fake Codex server also opens its error log from Python rather than
through `cmd.exe` redirection. The latter locked the log during overlapping
server shutdown/startup and caused resumed-session tests to exit before
the next fake server could start. This is a test-helper fix, not a change
to vendor protocol or usage accounting.

## Validation record

- UI unit suite: 870 passed. Changed editor component: 20 passed.
- Browser baseline: 131 passed, five failed. After fixes, all 10 tests in
  the affected editor/Markdown suites passed, including all five failures.
- Native unit suite after fixes: 607 passed, six intentionally ignored,
  zero failed, using two test threads on the laptop.
- Integration run: 92 suites, 480 passed, three failed, six ignored.
  The two missing-make failures passed in the five-case approval rerun.
  The fake-server log-lock failure passed after the helper correction;
  all 13 suites sharing that helper were rerun: 45 passed, zero failed,
  one ignored. Raw failing runs were retained, not relabeled as passes.
- Windows sandbox and native-tool regression suites after the shell fix:
  22 passed, zero failed.
- Installed preview native WebView: window opened, fresh-profile
  onboarding completed in an empty project, New task and Settings loaded,
  with no observed page JavaScript errors. The final installed development
  build also opened New task and Settings without observed JavaScript errors.
  The temporary debugging task and its window were removed after the check.
- Workspace/all-target compilation with warnings denied: passed.
- Clippy across the workspace and all targets with warnings denied: passed.
- Rust formatting and secret scan: passed.
- Installed development build and optimized GitHub preview live-model
  results: see below. Each artifact has its own qualification record;
  development-build results do not certify a release artifact.

The integration environment needs Git's Unix command-line utilities,
Python, Node and make, as on the Windows CI runner. CI also neutralizes
`core.autocrlf`; the laptop run temporarily applies the same setting and
restores the prior global value afterward. Test executables must not be
rebuilt while another run is executing them: Windows holds them open.

## Local model

Granite 4.2 3B, Q4_K_M, CPU backend, downloaded from the project's pinned
catalog. File size: 2,244,011,552 bytes. Verified SHA-256:
`e0406663965846ae22a403456eb826ccce5f450840491f71952f18a7cb78e7d5`.

The first coding run at an explicitly reduced 8,192-token context timed out
after 15 minutes without repairing the fixture. It ran during compilation
and repeatedly compacted history. This is a failed qualification attempt,
not evidence that the model completed the task. Subsequent runs used the
normal 16,384-token context after builds/tests finished.

A subsequent 16k run repaired the code and passed the independent five-test
check, but exhausted its 50k task-token budget while trying to verify the
result. The empty Python receipts led to the BusyBox defect above; this
attempt is not counted as a completed agent task. The post-fix run started
again from the original broken implementation. It preserved the original
tests and produced code passing all five independent tests, but timed out
after 900 seconds without completing the agent task. This also does not
qualify Granite as a recommended default on this laptop.

A Gemma 4 E4B Q4_0 QAT comparison uses the same original task and tests,
16,384-token context, a 100k task-token budget and a 1,800-second timeout.
Its 5,154,941,280-byte file was verified against the pinned catalog digest:
`676c35070db6dbe52f93e9c864ee0fba4eddea94b9c875d9cb10daff453fbaee`.
The comparison completed in 622.01 seconds with agent exit 0 and independent
verifier exit 0. The original five tests were unchanged. The agent's actual
sandboxed `python3 -m unittest -q` receipt contains `Ran 5 tests` and `OK`,
and the independent verifier also passed all five. A separate evaluator
checked mixed hashable/unhashable equality, input preservation, clamp bounds,
and chunk size/flattening properties (1,653 assertions), all passing.

This is evidence for a small Python repair task on this CPU, not a claim of
broad model reliability or cloud-agent qualification. Gemma is the preferred
local model from this comparison; Granite's unsuccessful attempts remain in
the record.

The live task is the repository's fixed `clamp`, `unique`, and `chunks`
Python repair fixture. Its original five tests are preserved, and the
resulting implementation is tested independently with an evaluator-owned
copy of those tests. Runtime startup alone is not a coding-quality pass.

## GitHub validation

PR #11 starts independent Windows, macOS and Linux builds. The first Linux
x86-64 desktop job failed before tests because full Rust debug information
and incremental objects exhausted the hosted runner disk (`os error 28`).
The Linux verification and release jobs now use line-table debug information
and disable incremental state; all existing gates remain enabled. The
current rerun has passed workspace tests on both architectures; remaining
packaging checks are tracked below.

The first Linux ARM run reached the integration tests and found a context
budget failure. A later x86-64 run exposed the same cause in four dedicated
4,096-token tester-route regressions: the expanded exec description raised
the short request to 4,113 tokens. The initially enlarged pressure fixture
was insufficient as a fix. The exec description is now concise while keeping
platform sandbox and relative-cwd guidance, and the pressure test is restored
to 4,096 tokens with explicit compaction/reduction/response-budget assertions.
Production context-budget enforcement and all tester-route limits remain
unchanged. On Windows, all five tester-route tests and the restored 4,096-token
pressure regression pass with the final schema, as does workspace/all-target
Clippy with warnings denied. The subsequent Linux workspace suites passed
on both architectures; their remaining packaging checks still need to finish.

The cold-process model-selection regression was reproduced with the prior
installed binary and passed with the corrected development installer. A
second selection after removing the configured file correctly failed, even
with the model previously cached. The normal laptop profile now selects the
verified Gemma model with a 16,384-token context.

## Optimized GitHub installer qualification

Source commit: `b5ecd8d87ad23f963bc569416dc8c589069003e1`.
Windows build, engine unit/integration tests and installer checks passed in
[run 41219098028](https://github.com/ShadowfetchStudio/ShadowCode/actions/runs/41219098028).
The separate release build passed in
[run 41219097933](https://github.com/ShadowfetchStudio/ShadowCode/actions/runs/41219097933).
These are PR artifacts, not published release downloads.

The preview installer's SHA-256 is
`7c077227703f05941289ac24816080847224c58f67474814e73fa144d989ff44`.
Its installed executable's SHA-256 is
`b996ff85a5feb96b07b761b34b4d1989ac4d8a4713cade2abf66e136dc144f9f`.
Clean-PATH startup passed. Native WebView checks passed replace-all, undo,
Ctrl+Shift+Z and Ctrl+Y redo, disk-verified save, and local-model settings,
with no observed page errors.

A fresh Gemma run on this preview completed in 613.60 seconds, with agent
exit 0 and independent verifier exit 0. All five original tests were
unchanged and passed. The agent executed the test command inside
AppContainer and returned the actual test output. It initially repeated
reads and attempted unavailable Git-based delegation in the non-Git
fixture, then recovered and completed the task. Those detours remain in
the event record; this does not establish broad agent reliability.
The earlier 1,653-property check applies to the development run only.

The release-workflow installer's SHA-256 is
`edbf891802fc7bc962665c3d845cba73cba3ec2d1b114a87f5d9a40737b93ee9`.
Its separate installation, clean-PATH startup and native WebView editor
checks passed. Its installed executable's SHA-256 is
`598b56f182eb95e78d956ef238628144b9d1cdb5b11415bfc213094dad8368d3`.
Its fresh Gemma run completed in 582.62 seconds with agent exit 0,
independent verifier exit 0, and all five original tests preserved and
passing. The agent's sandboxed test command also returned all five tests
passing. This run took unnecessary search/read turns before editing; it
qualifies this bounded fixture, not broad model reliability. A final
published installer must match qualified bytes or undergo qualification
again.

Both Linux architectures have passed workspace tests and the 100-task
native-window endurance check at this commit. The ARM packaging container
then failed because Alpine replaced exact package revisions. The build pins
have been refreshed against both architecture indexes, and retained musl
and zlib source records now match their actual package revisions, including
all distribution patches verified against APKBUILD SHA-512 values. Full
packaging qualification must pass on the refreshed inputs. Both Apple
silicon and Intel macOS builds passed in run 41219097984.

## Latest merged-main candidate

Source commit: `0b255b89874b1216530b3e8b7c51470f30d7020e` (PR #11).
The Windows release-workflow artifact from
[run 41223980845](https://github.com/ShadowfetchStudio/ShadowCode/actions/runs/41223980845)
was downloaded, hash-verified and installed on the laptop. Its installer
SHA-256 is
`bf2dcb028cef292d4f0fe883748565e36a3be9c4525ec1f5c2f77f8fafe2dad9`;
its installed executable SHA-256 is
`31fc75f0d9ae0a22f979a8663633cd6f2eaaaac87e50e64c8d4666430d98f112`.
Installation and clean-PATH runtime checks passed. Native WebView editor
replace-all, undo, both redo bindings, disk-verified save and local-model
settings passed with no observed page errors. The first connection to the
UI debug endpoint was attempted before startup completed; retrying against
the same application process succeeded.

A fresh Gemma run started at 17:53:47 UTC on October 31, 2026 and completed
in 391.23 seconds, with agent exit 0 and independent verifier exit 0.
All five original tests were preserved and passed. This run used the same
verified model, 16,384-token context, 100k task-token budget and disposable
repair fixture described above. It is a qualification of these exact PR
artifact bytes, not a published release or a general model benchmark.

The accompanying BusyBox source archive is byte-identical to the previously
validated archive, SHA-256
`c6345e913686ff61ab46757b19fad23e9bb1b5e1e273f132bc4333770bd55a96`.
Windows and both macOS architectures passed at this source commit. Both
Linux architectures also passed the full qualification workflow in
[run 41223980842](https://github.com/ShadowfetchStudio/ShadowCode/actions/runs/41223980842),
including package inspection, offline clean installation, offline runtime
source rebuilding, installer recovery, and packaged CLI, terminal, desktop,
Markdown and MCP checks. This closes the earlier Alpine packaging failure.
PR #11 was merged after all candidate checks passed; tagged release builds
and publication remain separate steps.


## Published v2.3.0 follow-up

The public installer from [run 41237210012](https://github.com/ShadowfetchStudio/ShadowCode/actions/runs/41237210012)
was downloaded and verified against the published checksums. Its SHA-256 is
`7d4673a3fc15e6bbec9b0f1110cd358f3cecf6b02b922d074a3b3ca6c2dff11a`;
the installed executable is
`015163355181c3576f03da3c11cf25d5ab56a5931eb6ec94f5b92bb556a8c9fd`.
The official PowerShell installer, clean-PATH startup checks and native editor
checks passed. The BusyBox source archive matches the previously validated
archive exactly.

The fresh Gemma task started at 20:38:51 UTC and ended after 1,029.63 seconds.
The independent check passed all five original tests, which remained unchanged,
but the agent exited with code 1. **This run did not pass qualification.** It
spent steps repeatedly trying to start write subagents in a folder without a
Git repository, then attempted external Git commands that failed to open the
null device inside AppContainer. It eventually edited the helper file, but
exhausted its task budget rather than completing the requested workflow.
A one-job development compilation began during the latter part of this run;
the elapsed time is not a model performance benchmark.

This exposed incomplete guidance around an existing prerequisite: write
subagents need a repository with an existing commit; direct edits and read-only
subagents do not. The Windows null-device restriction is already described in
the port notes. Passing editor checks or independent tests alone must not be
reported as a successful end-to-end model run.

## 2.3.1 preview installer qualification

On October 31, 2026, the Windows 11 Home x64 laptop (Ryzen 3 5300U, 32 GB
RAM) tested the preview installer produced by GitHub Actions run 41241860668
from commit `b842d5b36c13b22b48b7e2f29db27561fec1fcfc`. Its SHA-256 was
`816cf27f2a31fe06db99c50cd44c84a933a09255bba1f34a87be20bb6c39d987`;
the installed executable SHA-256 was
`51614a0ece41e9dce88f711af0de50f86e27001873d044989fd7d185cbb5a121`.
The installer and clean-PATH startup checks passed. The native interface check
saved an editor change, exercised undo and both redo shortcuts, opened settings,
and reported no page errors.

The installed preview ran a Python repair task using Gemma 4 E4B Q4_0 on CPU.
It executed the requested test command inside the Windows sandbox; all five
original tests passed independently and were unchanged. The agent returned
success in 562.51 seconds with a 16,384-token context and 100,000-token task
budget. This is evidence for that preview and fixture, not a reliability
benchmark or proof about a different release installer. The final published
installer requires its own verification. An earlier development-binary run
omitted the sandbox shell path and could not execute its test; it was not
counted as a passing qualification.
