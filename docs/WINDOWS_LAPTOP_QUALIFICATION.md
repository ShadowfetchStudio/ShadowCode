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
- Installed development build and live-model results: see below. Optimized
  GitHub installer qualification remains pending; these development-build
  results do not certify a release artifact.

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
and disable incremental state; all existing gates remain enabled. The rerun
and optimized Windows installer qualification are still required.

The first Linux ARM run reached the integration tests and found a fixture
budget failure: the complete tool schema plus preserved context required
4,108 tokens, exceeding its hard-coded 4,096-token window. The pressure
fixture now uses 8,192 tokens and explicitly asserts that compaction occurs,
reduces the history, preserves the task, and leaves a valid response budget.
The production context-budget enforcement is unchanged.

The cold-process model-selection regression was reproduced with the prior
installed binary and passed with the corrected development installer. A
second selection after removing the configured file correctly failed, even
with the model previously cached. The normal laptop profile now selects the
verified Gemma model with a 16,384-token context.
