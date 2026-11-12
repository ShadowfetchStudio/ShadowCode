# Onboarding navigation ownership fix — review checkpoint

Baseline: bf62e846f57d91df06aca3ab40158c0c7e5aee63. No commit or release mutation.

Boot now captures one selection generation before its first await, checks ownership at each asynchronous boundary and passes its original generation into restoration. A user session/project choice supersedes boot; restoration cannot mint a newer ticket. Project opening shares the existing native activation queue because the native project endpoint activates a session itself.

Workspace exposes explicit refreshIfCurrent/reloadConfigIfCurrent helpers for navigation. Existing no-argument refresh/reloadConfig callbacks wrap these helpers and ignore Promise result/event arguments, preserving useAppearance's existing contract. Guarded helpers reject stale config, sessions/status/jobs/projects, and git writes. Catalog reload and asynchronous comparison-list writes are gated by boot ownership.

Evidence:
- baseline-final.json: identical final navigation tests against an isolated git archive of bf62: 9 expected failures, 3 controls passing (12 total).
- focused-final.log: 23 passing tests (15 new regressions and 8 existing appearance tests).
- intermediate-optional-callback/: preserves the rejected intermediate implementation and its three deterministically failing callback-contract regressions; prior unit/build results there do not qualify the final source.
- full-unit.json: 928 passing, zero failures/skips, 160 files on revised source.
- typecheck.log, production-build.log, check-bundle.log: passed. validation-commands.json records final command exits.
- source-hashes.json: exact two product and three test files under review.

Full Chromium and scoped WebKit await final independent review. All controlled regressions use Happy DOM and the fixture API; they are not native Windows qualification. Physical native evidence must come from a newly built candidate with a new source SHA. Old bf62 CI snapshots/endurance remain in sibling source-ci-bf62e84; monitoring was explicitly transferred away.
