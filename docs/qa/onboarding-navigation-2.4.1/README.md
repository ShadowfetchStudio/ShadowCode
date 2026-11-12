# Startup navigation source validation

The two product and three test files in `source-hashes.json` passed 928 unit
tests, 170 Chromium cases and eight focused WebKit cases, with zero failures
or skips. Type checking, production build and fixture-isolation checks passed.
`verification.json` records counts, browser statistics and original report hashes.

The identical navigation regressions against isolated baseline bf62 fail nine
checks while three controls pass. See `baseline-final.json`, `baseline-final.txt`
and `baseline-provenance.json`; `baseline-app.txt` is the initial UI reproduction.
The independent final review found no actionable issues after preserving public
refresh callback compatibility. `REVIEW-STATUS.md` is an earlier checkpoint;
its then-pending browser checks are resolved by `verification.json`.

These source and simulated-backend checks do not qualify any native installer.
Previous bf62 Windows failures remain separately recorded. Original logs, full
reports, rejected intermediate callback code and baseline archive are retained
in external `publication-2.4.1/onboarding-navigation-fix`.
