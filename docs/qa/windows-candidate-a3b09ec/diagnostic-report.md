# a3b09ec Windows navigation diagnostic — not qualification

Candidate commit: `a3b09eca6333c2befda3504850f357f09cc25542`; Windows Actions run `43184020556`, attempt 1, artifact `13928708773`. Same installed bytes as failed acceptance; fresh owned diagnostic profile.

**Observed: the project-plus click reached an enabled button while composerLocked was still visibly true.** The new second session was selected before that click and remained selected through the original 5-second failure. No selection reversal was observed.

| Time (performance ms) | Observation | Selected ID | Composer working / attachment disabled |
|---:|---|---|---|
| 2552.2 | Sidebar New task capture, before handler | (none) | False / False |
| 2556.1 | Busy becomes visible | (none) | True / True |
| 2637.1 | New session selected | 3ead8c2c1c6b44bda286e4e768752ae6 | True / True |
| 2756.4 | Project-plus capture, before handler | 3ead8c2c1c6b44bda286e4e768752ae6 | True / True |
| 2902.5 | Busy clears | 3ead8c2c1c6b44bda286e4e768752ae6 | False / False |
| 7808.8 | Diagnostic end | 3ead8c2c1c6b44bda286e4e768752ae6 | False / False |

At the project-plus click (2756.4 ms), the button was enabled, the click was trusted, textareaDisabled was false, composerWorking was true, and attachButtonDisabled was true. Busy cleared at 2902.5 ms: **146.1 ms after the click**. The textarea stayed enabled throughout, so its existing toBeEnabled assertion does not establish navigation readiness. All 13 timeline records were retained; dropped=0.

SQLite independently contains exactly two sessions: initial `2212a320b1d24f1cba0c7c32ad6311b9`, then `3ead8c2c1c6b44bda286e4e768752ae6`. No third session, events=0, tasks=0. This matches the earlier acceptance attempt’s two-session pattern, where newer `9e726902a64e4f7d97f74231ab0d269c` remained selected.

**Interpretation and limits:** This supports a second creation request discarded while the first navigation was still busy. Exact candidate `ui/src/hooks/useNavigation.ts:224–230` returns early for creating/submitting/switching, and holds switching during new-session/open-session work. DOM instrumentation does not directly observe creating.current or API call order; it cannot distinguish which guard branch returned or identify a specific awaited refresh. No evidence in this diagnostic supports a boot selection reversal. The enabled project-plus control during this interval and the probe’s ineffective textarea readiness check are separate facts; main owns the decision on product/QA changes.

**Scope:** One authorized diagnostic run only. Read-only MutationObserver and capture-phase pointer/click observation; original normal clicks and conversation assertions retained. No added wait/barrier, forced click, CSS changes, fake backend, API interception, or source changes. Stopped at the conversation failure; geometry 0/9, Hide 0/45. Diagnostic and candidate acceptance are not passed. No endurance/model work.

**Preservation:** 13 diagnostic priority files copied from Windows and SHA256 verified (receipts, screenshot, logs, SQLite/WAL/SHM); see `diagnostic-copy-verification.json`. Original failed acceptance priority evidence remains alongside it. SQLite was queried only from a separate inspection copy. Full profiles and all Windows roots remain preserved; browser caches were not copied before this handoff.

**Cleanup:** Both runners report app_exited/node_exited true, no forced termination and no cleanup errors. Completed owned tasks are removed only after proof preservation; exact final process/task/9223 checks are in `final-owned-state.json`, with both original cleanup receipts copied.

**Provenance hashes:**

- Installer SHA256: `3cbf1f1d1439d53ee505c40050e9a03dc476cfb0a4377f9e8433fb32d0f8b97e`
- Installed EXE/extracted NSIS payload SHA256: `2b9b751420f08045f0f1e803119ccc38abf3b724db40139eabc8b151e0be4676`
- Installation receipt: `267a354f667c48210b5627b5ece5d8c3820c61fb1d76f23e53be84d7cd895150`
- Frozen acceptance probe, unchanged: `1cf560ea7651e8db3b128131b72d132f7bf75f321ab0c7efc6145ea9bd2d4ac7`
- Separate diagnostic probe: `9418d63c4c2232fd9d8054b91f5cf34ed11fb340b6a8718743eff9ceb0058f45`
- Diagnostic UI receipt: `98130f80c787efc917374381ea87dcf7a0dda81cd311df39471b02e4d594a580`
- Diagnostic runner receipt: `9e4bc38076d4a4a8833f8032fa69508563c4c7b6763f84798f59ef7552028d12`

No further execution or acceptance modification authorized by this report.
