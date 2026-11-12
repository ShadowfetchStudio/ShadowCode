# Publisher authentication contract

The helpers in `scripts/native-release-auth.mjs` and `scripts/verify-native-release.sh` verify offline publisher signatures. They do not install, execute, download or publish an application, update trusted keys, or generate production keys. CI tests their behavior with disposable fixture keys. Current public trust and protected-environment observations are recorded below. The installer uses these helpers before executing a candidate and explicitly refuses `--unverified`. [Version 0.33.1](https://github.com/ShadowfetchStudio/ShadowCode/releases/tag/v0.33.1), published on September 28, 2026, is the first signed release.

The Bash verifier loads `scripts/native-release-auth-lib.sh` from its own script directory. Keep both reviewed code files together in the trusted tooling bundle; do not obtain the library from the candidate download or source metadata as shell code. The installer uses the same reviewed routines for current candidates and signed historical receipts; it never sources release metadata as code.

## Published Linux release: 2.4.1

[Release 2.4.1](https://github.com/ShadowfetchStudio/ShadowCode/releases/tag/v2.4.1), ID `442808765`, was published at **2026-11-12 10:46:44 UTC** from immutable source `a3b09eca6333c2befda3504850f357f09cc25542`. Linux release run `43192014736`, attempt 1, completed successfully. The [full-platform audit](qa/platform-release-2.4.1/public-assets/verification-summary.json) verified all 23 public assets and all four successful release workflows.

Both [x86_64](qa/platform-release-2.4.1/x86_64-handoff.json) and [aarch64](qa/platform-release-2.4.1/aarch64-handoff.json) passed all 15 required gates. The [protected-source activation](qa/platform-release-2.4.1/protected-activation.json) recorded the exact a3b09ec tooling pin and v2.4.1 tag allowance at 09:30:08 UTC. [Fresh environment](qa/platform-release-2.4.1/protected-environment.json), [tag-rule](qa/platform-release-2.4.1/protected-tag-rules.json) and [tooling](qa/platform-release-2.4.1/protected-tooling.json) readbacks preceded [signing approval](qa/platform-release-2.4.1/signing-approval.json) at **10:44:07 UTC**. Earlier activation receipts retain their then-pending signing status.

[Public Linux verification](qa/platform-release-2.4.1/linux-public-verification.json) authenticated all six payloads and matched their hashes to the approved handoffs. The [full audit](qa/platform-release-2.4.1/public-assets/linux-signature-verification.json) independently verified those six payloads with the reviewed source trust. [APT verification](qa/platform-release-2.4.1/apt-public-verification.json) passed with signed indices and byte-identical public DEBs. Public Windows installation, UI, endurance and model outcomes are recorded separately in [platform qualification](PLATFORM_QUALIFICATION.md#241-public-release).

The published 2.4.1 policy retains key identity, epoch 1, targets and floor 0.33.0, extending the existing inclusive ceiling to 2.4.1. Ed25519 authentication covers six Linux payloads; checksums for Windows, macOS and Flatpak do not establish publisher signatures, Authenticode, notarization or native acceptance.

## Historical published Linux release: 2.4.0

The following checkpoint retains its original results and then-current pending statements.


[Version 2.4.0](https://github.com/ShadowfetchStudio/ShadowCode/releases/tag/v2.4.0)
was published for x86_64 and aarch64 on **November 12, 2026 at 04:35:24 UTC**
(November 11 in US Eastern time), as public release `442500290`. The immutable
`v2.4.0` tag and independently reviewed tooling pin both identify
`25c8345f99f246b37ea45bf9306eb551da9c0819`.
[Release run 43145082420](https://github.com/ShadowfetchStudio/ShadowCode/actions/runs/43145082420),
**attempt 1**, completed successfully through protected signing, publication and
APT publication.

Before signing approval, all **15 required gate receipts for each Linux target**
were validated against that exact commit, run and attempt, including gate-script
digests and handoff artifact hashes. All required gates passed; optional live
checks retain their recorded exclusions. At 04:37:08 UTC, all **14 public Linux
assets** were downloaded and their hashes checked. Both signed envelopes verified
with the tracked Ed25519 key, authenticating all **six payloads**: an AppImage,
DEB and runtime-source archive per architecture. The exact inventory is in
[the release procedure](RELEASING.md). This is published-byte authentication;
it does not claim qualification beyond the recorded gate scopes.

Independent live APT verification at **04:40:38 UTC** confirmed `shadow-code`
2.4.0 for amd64 and arm64. Both `InRelease` and `Release.gpg` verified using only
the tracked public key with primary fingerprint
`1BC07B5ECFDB514673A296FB021CAB3F2F7A1F61`. All six signed architecture index files
matched their hashes and sizes, and both live pool DEBs were byte-identical to
the public GitHub release DEBs. The
[APT job](https://github.com/ShadowfetchStudio/ShadowCode/actions/runs/43145082420/job/130975332956)
succeeded at 04:38:26 UTC; the
[live signed index](https://shadowfetchstudio.github.io/ShadowCode/apt/dists/stable/InRelease)
is separate from the Ed25519 release envelopes. Evidence is retained externally
in `publication-2.4.0/public-linux/public-verification.json`,
`publication-2.4.0/release-handoffs/{x86_64,aarch64}-verified.json`, and
`publication-2.4.0/apt-public-verification/proof.json` with public files and logs. A portable copy of the [public Linux verification](qa/platform-release-2.4.0/linux-public-verification.json), [APT verification](qa/platform-release-2.4.0/apt-public-verification.json), and [x86_64](qa/platform-release-2.4.0/linux-x86_64-handoff.json)/[aarch64](qa/platform-release-2.4.0/linux-aarch64-handoff.json) handoff checks is tracked with this documentation.

Windows, macOS and Flatpak 2.4.0 were subsequently published by their separate
workflows. All final 23 public assets passed [downloaded-byte verification](qa/platform-release-2.4.0/public-assets-verification.json).
Linux signatures do not cover those other formats. Physical Windows testing
found a short-window composer/dock overlap at 175% zoom; 2.4.1 is a source
candidate to correct it. This does not alter the immutable 2.4.0 tag or assets.

The published 2.4.0 policy extends the existing key through 2.4.0. The 2.4.1
source candidate extends the same ceiling to 2.4.1; its signing configuration
and package qualification are separate pending work. Its key ID,
epoch, targets, minimum version, signature format and required receipt verification
are unchanged. Live configuration confirms the reviewed tooling SHA above and
an exact `v2.4.0` deployment allowance, retaining the three 2.3.x tag rules and
existing owner-review protections. A source policy change alone never authorizes
signing; later releases require the independent review described in
[RELEASING.md](RELEASING.md). Historical release evidence follows.

## Published release: 2.2.0

[Version 2.2.0](https://github.com/ShadowfetchStudio/ShadowCode/releases/tag/v2.2.0) was published on October 17, 2026 from `444e75f13c3512d57c226b39d6edf59fdb08a4c6` by [run 39059462934](https://github.com/ShadowfetchStudio/ShadowCode/actions/runs/39059462934) (attempt 1), for x86_64 and aarch64. Before approving the signing review, all 15 receipts of each target were checked: passed for that commit, run and attempt, no required skips, exit status 0, script digests matching the tagged gate definitions for that architecture, and artifact hashes matching the handoff files. The published packages are byte-identical to the verified handoff; the authenticated installer installed it over 2.1.0 on the release machine and its first-window check passed. The APT repository lists 2.2.0 for amd64 and arm64 and verifies with `gpgv` against the key recorded in `release/trust/APT-SIGNING-KEY`. The macOS disk images and Flatpak bundles were then built from the tag by `release-macos.yml` and `release-flatpak.yml` and attached with their SHA-256 files; they are not covered by the publisher signature. Those two workflows had to be started by hand for 2.2.0 (a release published with `GITHUB_TOKEN` does not trigger them); from the next release the publish job dispatches them.

## Earlier published release: 2.1.0

[Version 2.1.0](https://github.com/ShadowfetchStudio/ShadowCode/releases/tag/v2.1.0) was published on October 11, 2026 from `a32c2af917b30d7104c4d12aa6a343e73dabb4f6` by [run 38169859337](https://github.com/ShadowfetchStudio/ShadowCode/actions/runs/38169859337) (attempt 3), for x86_64 and, for the first time, aarch64. Before approving the signing review, all 15 receipts of each target were checked: passed for that commit, run and attempt, no required skips, and script digests matching the tagged gate definitions for that architecture. All four packages verify with `verify-native-release.sh` against the tracked trust bundle; the authenticated installer installed it over the existing copy on the release machine, and its new first-window check passed. The APT repository at `https://shadowfetchstudio.github.io/ShadowCode/apt` is signed by the key recorded in `release/trust/APT-SIGNING-KEY` and verifies with `gpgv`.

## Published release: 1.0.0

[Version 1.0.0](https://github.com/ShadowfetchStudio/ShadowCode/releases/tag/v1.0.0) was published on September 30, 2026 from `e0ab26553cec4243dfb1aeabb66b206bbc6c0474` by [run 36677001772](https://github.com/ShadowfetchStudio/ShadowCode/actions/runs/36677001772) (attempt 2): all 15 required gates, protected signing and publication completed in the workflow. Before approving the signing review, every receipt was checked: passed, exit 0, that commit, run and attempt, no required skips, and script digests matching the tagged gate definitions. The downloaded AppImage and .deb verify with `verify-native-release.sh` against the tracked trust bundle, and the authenticated installer upgraded an installed 0.34.2 to it.

## Published release: 0.34.2

[Version 0.34.2](https://github.com/ShadowfetchStudio/ShadowCode/releases/tag/v0.34.2) was published on September 29, 2026 from `3f81044e1fe3d8f24cc1293e8efde79db5533213` by [run 36515721147](https://github.com/ShadowfetchStudio/ShadowCode/actions/runs/36515721147): all 15 required gates, protected signing and publication completed in the workflow. The downloaded AppImage and .deb verify with `verify-native-release.sh` against the tracked trust bundle, and the authenticated installer upgraded an installed 0.33.1 to it. The `v0.34.0` and `v0.34.1` attempts stopped in required gates before signing and stay unchanged (see [RELEASING.md](RELEASING.md)).

## Published release: 0.33.1

The `v0.33.0` release attempt at `9e385cb` failed its source-integrity gate
before signing/publication ([run 36414378697](https://github.com/ShadowfetchStudio/ShadowCode/actions/runs/36414378697)).
Its tag remains unchanged. The 0.33.1 release and reviewed tooling are pinned to
`e15c4480e65db5650af012bb2a9773dbe89acf84`. [Run 36427024374](https://github.com/ShadowfetchStudio/ShadowCode/actions/runs/36427024374),
attempt 1, passed all 15 required build gates and protected signing. Its
publication job failed on a transient draft-listing response; the frozen
publisher then resumed locally with the same signed artifact `10987931982`, compared
all seven downloaded remote assets and published the release. The workflow
failure remains recorded. Publication does not establish a local installation
or qualification beyond the recorded gates.

## Trust and security contract

The authorized canonical publisher is `ShadowfetchStudio/ShadowCode`, repository ID `1377099349`, owner ID `209457103`. GitHub confirmed the account rename on October 10, 2026 with both numeric identities unchanged. The historical `Shadowfetchapps/ShadowCode` and `ShadowfetchLinux/ShadowCode` URLs redirect to this repository. The current contract supports stable `MAJOR.MINOR.PATCH` releases for `x86_64-unknown-linux-gnu` and `aarch64-unknown-linux-gnu`, with separate target-bound envelopes.

SHA-256 establishes byte integrity. The detached Ed25519 signature establishes that the holder of an already trusted publisher key signed the release envelope. It does not independently prove which workflow ran, that code is safe, or that the release is the newest available. The workflow identity is currently a publisher assertion; a future GitHub attestation can add an OIDC-backed workflow identity proof.

The trust directory must come from an independently trusted installer/policy bundle, not from the candidate download. There is no adjacent-key discovery or default test key. Explicitly pointing `--trust-dir` at attacker-provided material defeats the premise; the production installer must choose its own pinned trust path, not accept one from release metadata or an environment override.

The initial installer/key bootstrap requires an authenticated distribution channel: use a reviewed canonical repository revision and independently published public-key fingerprint, or another authenticated distribution channel. A verifier/key distributed beside an arbitrary download does not authenticate itself. This prototype is not a new automatic updater.

## Exact envelope and bindings

`RELEASE-AUTH` is at most 4096 bytes, printable ASCII plus LF/TAB, with a final LF and exactly 16 ordered lines. Unknown, missing, duplicate and reordered fields are rejected. Scalar values cannot contain `=` or TAB. Numeric version components and key epochs are bounded to nine decimal digits with no unnecessary leading zeroes. Commit is exactly 40 lowercase hexadecimal digits; hashes are exactly 64.

New envelopes use `ShadowfetchStudio/ShadowCode`. Existing releases through 1.0.1 retain the signed `Shadowfetchapps/ShadowCode` name. Both Node and OpenSSL verification accept exactly those two names while requiring the same numeric repository ID, owner ID, trusted key and all other bindings. The shipped trust policy retains its historical name and key intervals; the account rename does not authorize a new signing key or extend a key interval.

The line order is:

1. Literal `ShadowCode-Release-Auth-v1`.
2. `repository=ShadowfetchStudio/ShadowCode` (or the historical signed name above).
3. `repository-id=1377099349`.
4. `owner-id=209457103`.
5. `version=MAJOR.MINOR.PATCH`.
6. `tag=vMAJOR.MINOR.PATCH`, exactly matching version.
7. `commit=COMMIT_SHA`.
8. `target=x86_64-unknown-linux-gnu` or `target=aarch64-unknown-linux-gnu`.
9. `channel=stable`.
10. `key-id=SHA256_OF_ED25519_SPKI_DER`.
11. `key-epoch=POSITIVE_INTEGER`.
12. `manifest-sha256=SHA256_OF_EXACT_RELEASE_MANIFEST_JSON_BYTES`.
13. `checksums-sha256=SHA256_OF_EXACT_SHA256SUMS_BYTES`.
14. `asset=appimage<TAB>ShadowCode_VERSION_amd64.AppImage<TAB>SIZE<TAB>SHA256`.
15. `asset=deb<TAB>ShadowCode_VERSION_amd64.deb<TAB>SIZE<TAB>SHA256`.
16. `asset=runtime-sources<TAB>ShadowCode_VERSION_appimage-runtime-sources.tar.gz<TAB>SIZE<TAB>SHA256`.

Those are the x86_64 names. An `aarch64-unknown-linux-gnu` envelope names `ShadowCode_VERSION_aarch64.AppImage`, `ShadowCode_VERSION_arm64.deb` and `ShadowCode_VERSION_aarch64_appimage-runtime-sources.tar.gz` instead, so both targets' packages can sit side by side. Each target has its own envelope, signature, manifest and checksums, published in the same GitHub release under per-target names:

| | x86_64 | aarch64 |
| --- | --- | --- |
| Envelope | `RELEASE-AUTH` | `RELEASE-AUTH-aarch64` |
| Signature | `RELEASE-AUTH.sig` | `RELEASE-AUTH-aarch64.sig` |
| Manifest | `RELEASE-MANIFEST.json` | `RELEASE-MANIFEST-aarch64.json` |
| Checksums | `SHA256SUMS` | `SHA256SUMS-aarch64` |

The x86_64 names are historical and unchanged, so existing installers keep working. The requested package basename selects which names a verifier reads (an `_aarch64`/`_arm64` package reads the `-aarch64` metadata), and the envelope found there must name that same target; an envelope filed under another target's names is refused before any digest check. The names describe only the published release: a verified stage and the installer's accepted-release receipt always keep the historical names, whatever the target. The rest of this document says `RELEASE-AUTH`, `SHA256SUMS` and so on for either target's file.

`RELEASE-AUTH.sig` is exactly the 64-byte raw Ed25519 signature over all envelope bytes. There is no home-grown cryptography, prehash signature variant, URL field, arbitrary asset path or shell-sourced content. The domain marker prevents reuse as a different application statement.

The complete three-asset list is always authenticated. `SHA256SUMS` must contain exactly those entries in that order, matching the current `check-native-package.mjs` producer: each `HASH`, two spaces, basename, LF. Duplicate, extra, path-bearing and contradictory entries fail even when the checksum-file digest is correctly signed. Each artifact is nonempty and at most 32 GiB. The exact JSON manifest is hash-bound and limited to 1 MiB. Its audit contents are opaque to the shell verifier; the envelope is the authoritative install identity. The Node construction API additionally checks the manifest's current schema/tag/commit/target and exact asset map and requires the existing pretty-printed JSON serialization, which rejects duplicate JSON fields. Publisher receipt validation remains the responsibility of the existing release gates and publisher before signing.

Consumers may download only their selected package plus the envelope, signature, manifest and checksums; they do not need both package formats or the source archive. The selected basename must exactly match one authenticated entry.

## Trust policy and rotation

The explicit trust directory contains `policy` and one `KEY_ID.pem` public key per accepted/history key. PEM public keys are bounded to 1024 bytes and must be the canonical public SPKI serialization produced by Node/OpenSSL, with no extra PEM blocks. Both verifiers reject a matching private-key container, including a private key appended after a valid public block; only the signing API accepts private keys. The decoded key must be Ed25519, and the SHA-256 of its DER bytes must match the authenticated key ID. The shell additionally checks the exact Ed25519 SPKI encoding.

`policy` is at most 4096 bytes with these nine fixed lines, followed by one to eight unique key lines:

1. `ShadowCode-Release-Trust-v1`.
2. `repository=ShadowfetchStudio/ShadowCode` (or the historical signed name above).
3. `repository-id=1377099349`.
4. `owner-id=209457103`.
5. `target=TARGETS`: `x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu`, or both separated by a comma (no spaces, no duplicates). An envelope whose target the policy does not name is refused, and a release cannot switch target against its accepted history.
6. `channel=stable`.
7. `minimum-epoch=POSITIVE_INTEGER`.
8. `minimum-version=MAJOR.MINOR.PATCH`.
9. `keys=ed25519-spki-sha256`.
10. Each `key=EPOCH<TAB>KEY_ID<TAB>MINIMUM_VERSION<TAB>MAXIMUM_VERSION`.

Each key has an inclusive version range and exactly one epoch. Unknown keys, different public bytes under a known ID, retired epochs and versions outside the trusted range/floor fail. No policy/key update can be authorized merely by placing new keys beside a release.

For a reviewed rotation, distribute a new authenticated trust bundle with the new public key and higher minimum epoch/version. Retain the old public key with its historical version range only when needed to verify an existing accepted-state receipt. The internal history check may ignore current minimum floors, but it still verifies the old signature, identity, key epoch and historical key range. This exception is not exposed as an install-verification API. Deleting an old key outright can make old state unverifiable; the installer must then fail pending explicit migration, not erase the state or assume a fresh install.

The tracked `release/trust` bundle contains the public Ed25519 key with ID `f0c60ff8228314616985712f8918c9798c0ecf72b7271e19343a041c25663b7f`. Its epoch is 1, minimum version is 0.33.0, and its published 2.4.1 inclusive key range is 0.33.0–2.4.1 (the published 2.4.0 tag ends at 2.4.0). Historical provisioning checkpoints covered 0.33.0–2.1.0 on October 11, 2026 and 0.33.0–2.2.0 on October 17, 2026; those are dated records, not current ceilings. It authorizes no version after 2.4.1 without a reviewed policy update; the policy extension alone does not authorize signing or publication. The private key is not distributed in the repository or installer bundle. Fixture keys remain temporary and separate. Public fingerprint distribution, custody and future rotation/revocation remain owner responsibilities.

## Downgrade, replay and accepted state

Both verifiers can compare the candidate with a supplied prior accepted `RELEASE-AUTH` plus signature. They cryptographically verify that prior receipt, then reject a lower version, lower signing epoch, or any different envelope bytes under the same version. Identical retries are accepted. Comparison is numeric by stable version component, not lexicographic or a GitHub run number.

The stateless verifier module does **not** discover or persist installed state. The installer now supplies its durable highest accepted receipt under the installation lock/journal, refuses missing/corrupt state for an existing authenticated installation, and never decrements it during rollback/recovery. Supplying an older genuinely signed receipt or deleting local state cannot be detected by a stateless verifier. Local same-user compromise is outside this trust boundary.

The trust policy's minimum version limits first-install replay to a known floor. A fresh offline host still cannot know the latest release or learn that a signing key was revoked after its last trusted policy update. There is no timestamp/expiry freshness claim. Unattended update discovery, trusted-clock freshness rules and database downgrade behavior are not implemented.

## APIs and exact staged bytes

`native-release-auth.mjs` exports:

- `createEnvelope({bundleDir, version, commit, keyId, keyEpoch}) -> Buffer`: validates all three actual package files, canonical checksums and current manifest bindings; emits deterministic envelope bytes.
- `signEnvelope(bytes, privateKeyPem) -> Buffer`: checks the envelope and signing-key fingerprint, then uses Node's Ed25519 implementation. It never creates a key or writes one.
- `verifyEnvelope({bytes, signature, trustDir}) -> metadata`: validates current trust policy and the Ed25519 signature. This verifies metadata only, not package contents.
- `verifyBundle({bundleDir, trustDir, artifact, previousDir?, expectedVersion?, expectedCommit?}) -> metadata`: verifies signature, previous-state constraints, exact metadata/checksum bindings and selected package bytes. This read-only Node API is for CI; it does not retain an execution-safe snapshot.
- Strict parser/identity helpers and explicit limits used by fixtures.

The end-user path is Bash plus OpenSSL 3 and ordinary GNU coreutils/diffutils; it requires no Node, Python, Rust, GitHub CLI or compiler:

```text
bash verify-native-release.sh \
  --bundle-dir DOWNLOADED_FILES \
  --trust-dir INDEPENDENTLY_TRUSTED_KEYS \
  --artifact ShadowCode_2.4.1_amd64.AppImage \
  --stage-dir NEW_PRIVATE_STAGE \
  --expect-version 2.4.1 \
  --expect-commit EXPECTED_COMMIT
```

`--previous-dir` optionally supplies the durable prior accepted envelope/signature. Every option is unique; missing mandatory arguments and unexpected options fail. There is no bypass/unsigned option.

The shell snapshots all relevant inputs into a private 0700 directory. GNU `dd` uses `nofollow,nonblock,count_bytes` and copies at most the observed, bounded file size plus one byte. This closes a post-check symlink swap and prevents an injected FIFO from blocking the input open/read. Exact snapshot size/hash/signature are checked. The selected artifact remains mode 0400 and is **never executed**. On success a same-filesystem, non-overwriting rename retains only the five verified files at the requested new stage path. Failure removes private scratch data and leaves any pre-existing stage untouched.

The installer executes and installs only this verified private snapshot, never the original mutable download path. The read-only mode prevents accidental writes; it is not immutable against an attacker already controlling the same user. Existing checksum mismatch, managed-runtime and journal checks must remain. The previous `--unverified` flag is explicitly refused before destination creation; it has not become a signature bypass.

## Release workflow and provisioning boundary

The release workflow now separates source build/qualification, signing, and publication. `prepare-native-release.mjs` creates an unsigned handoff containing the exact three packages, canonical checksums/manifest and required gate receipts. A fresh signing runner downloads that build's immutable Actions artifact ID as data. It checks out signing code and public trust from an independently reviewed commit, validates the current repository/tag/commit/run/attempt and all required receipts, and signs private snapshots. It does not execute packages, install source dependencies, or restore build caches. Only its signing step receives the private key.

A separate publisher runner receives the signing job's immutable artifact ID and repository write permission, but no signing secret. `publish-native-release.mjs` requires exactly seven public assets per target (three payloads plus four metadata/signature files), fourteen for the two-target Linux publication, verifies private snapshots before any GitHub call, checks remote repository and tag identity, stages a draft, and compares every remote asset's bytes before publication. Identical published retries are read-only; changed bytes under an existing version are refused. `VERIFICATION.json` is bounded CI transport data, not a release asset. Run IDs qualify each attempt without changing immutable release bytes.

The workflow deliberately refuses missing owner configuration. The following records the November 12, 2026 UTC provisioning observation with historical checkpoints identified explicitly; recheck live settings before dispatching any later release:

- The tracked `release/trust` public policy and key bundle must be included in the reviewed tooling commit and distributed through an authenticated channel. It contains public material only; no default fixture key is trusted.
- Repository variable `NATIVE_RELEASE_TOOLING_COMMIT` must pin the exact 40-character reviewed and pushed commit containing the current gate definitions, signing/publisher code, public trust and release-appropriate notes. The 2.4.1 live-read-back pin is `a3b09eca6333c2befda3504850f357f09cc25542`, with evidence [protected-activation](qa/platform-release-2.4.1/protected-activation.json); [protected-environment](qa/platform-release-2.4.1/protected-environment.json); [protected-tag-rules](qa/platform-release-2.4.1/protected-tag-rules.json); [signing-approval](qa/platform-release-2.4.1/signing-approval.json). The historical reviewed and live-read-back pin for 2.4.0 was `25c8345f99f246b37ea45bf9306eb551da9c0819`. Historical pins included `e15c4480e65db5650af012bb2a9773dbe89acf84` for 0.33.1 on September 28, 2026 and the tagged `v2.2.0` release commit on October 17, 2026 (`v2.1.0` for 2.1.0, `v1.0.1` for 1.0.1, `v1.0.0` for 1.0.0, `v0.34.2` for 0.34.2). Never infer this pin from an unreviewed tag.
- Repository variable `NATIVE_RELEASE_SIGNING_ENVIRONMENT` is set to `release-signing`. Its verified configuration requires the `ShadowfetchStudio` User reviewer (ID `209457103`, unchanged after the account rename), allows self-review and retains GitHub's default administrator override. The 2.4.1 rule/protection readback is [protected-activation](qa/platform-release-2.4.1/protected-activation.json); [protected-environment](qa/platform-release-2.4.1/protected-environment.json); [protected-tag-rules](qa/platform-release-2.4.1/protected-tag-rules.json); [signing-approval](qa/platform-release-2.4.1/signing-approval.json). At the 2.4.0 checkpoint, its custom deployment rules permitted exactly `v2.3.1`, `v2.3.2`, `v2.3.3` and `v2.4.0`; the 2.4.0 allowance was added without weakening review protections. Historical release-specific rules included `v2.2.0` on October 17, 2026 and `v2.1.0`, `v1.0.1`, `v1.0.0`, `v0.34.2` and `v0.33.1` for their earlier releases. This is an owner-reviewed gate, not a two-person approval guarantee; a later release needs an explicit rule/policy update.
- Environment secret `NATIVE_RELEASE_SIGNING_KEY_PEM` has been uploaded to `release-signing`. It is scoped to the signing environment, not repository-wide secrets or the build job. Its presence does not prove that a candidate has been signed.

Owner review of the release workflow/source and repository protections remains necessary: another authorized workflow could request the same environment secret. Local gate receipts are validated assertions, not independent attestations that an adversarial producer executed the commands. Workflow dependencies and exact artifact IDs bind the proposed job flow; local fixtures do not prove GitHub control-plane behavior. Remote checks are observations, not atomic compare-and-swap against independently authorized concurrent changes.

All existing required gates remain, with a new required `built-project-cleanup` gate running the exact release-profile cleanup test over actual installed UI dependencies and output. The default Rust suite transfers only this test to that gate; missing, failed or ignored qualification rejects signing and publication. This scope does not claim full Cargo-cache cleanup qualification.

The tracked AppImage installer authenticates candidates and retains durable accepted-state receipts. The historical September 28, 2026 publication of seven authenticated 0.33.1 assets completed with the workflow failure and publication recovery recorded above. The published .deb was also authenticated into a private snapshot and installed in a network-disabled runtime-only container; version, CLI/MCP and first-window checks passed (see the implementation ledger). Independently authenticated installer bootstrap distribution and the broader installation/upgrade/rollback lifecycle remain separate qualification requirements. Existing installed applications and older public releases are not authenticated retroactively.

## Trusted installer and durable accepted state

Distribute a complete, independently authenticated bundle containing `scripts/install-appimage.sh`, `scripts/install-release-state.sh`, both Bash verifier files, `release/install-policy`, the `release/trust` policy/public keys, `assets/icons/shadow-agent.svg` and `packaging/shadow-agent.desktop`. A development checkout is not a runtime dependency when this bundle is complete. The installer resolves its actual script file before choosing sibling code/trust, so a convenience launcher symlink cannot choose an adjacent substitute bundle. The candidate, working directory and environment cannot override this trust root. Path resolution does not authenticate the initial bundle or protect it from its owner modifying it.

The tracked `release/install-policy` has exactly these two lines:

```text
ShadowCode-Install-Policy-v1
first-authenticated-version=0.33.0
```

This immutable boundary distinguishes old unsigned installations from an authenticated installation whose state disappeared. It is not the current minimum-version floor and must not be advanced during key rotation. Incoming candidates below it are refused before execution, even if the trust policy's floor is lower. The tracked boundary is 0.33.0; setting it does not establish that this release has been published.

The installer accepts only the authenticated AppImage role. It checks the private snapshot's reported version and bundled runtime before changing installed files. Signed metadata is retained in private, content-addressed receipt generations under `~/.local/lib/.shadowcode-release-state`. A schema3 intent binds the prior/candidate receipt identities, exact app/runtime fingerprints, installation roots and pre-activation launcher/desktop identities. The accepted pointer becomes durable before app/runtime replacement; rollback can restore an earlier working application without lowering the highest accepted release.

Recovery accepts exact recorded pre-activation states. With a schema3 intent, it also recovers a crash at the activation marker or immediately after active AppImage link replacement when the link points to the exact recorded prior or candidate AppImage and the recorded launcher, symlink, icon and desktop-entry identities and their installation roots are unchanged. A changed integration, unexpected active link, or changed package is preserved for manual review. During a handled installation failure, the installer restores launcher, symlink, icon and desktop-entry files from staged copies when the live identities still match the recorded prior or candidate files; an unrelated edit is preserved for review. A crash after these integration files change still requires manual recovery. Older schema1/schema2 intents retain their original recovery limits; schema2 activation-started intents are not promoted without the new evidence. Historical receipt checks retain signature/identity/key-range verification while allowing old current floors. First-window/database downgrade qualification remains incomplete. Restoring a complete old application/state backup cannot be detected by this offline local high-water record.

Compatibility change: the signed entry point rejects checksum-only installation, `SHADOWCODE_SHA256SUMS` overrides and `--unverified`. Use the documented source build with a separate profile for development; a separate unsigned packaged-development installer has not been implemented. Existing published unsigned assets must not be silently repackaged or overwritten under the same version.

## Evidence and limitations

Run `node --test scripts/test-native-release-auth.mjs` from the repository root. Tests use ephemeral Ed25519 keys, real OpenSSL verification, malicious-but-unexecuted executable fixtures, signed malformed metadata, wrong-key/identity/version/target cases, jointly changed package/checksums, history tampering, rotation and downgrade checks, bounds, path traversal, symlinks/FIFOs, and deterministic post-validation symlink/FIFO swaps through a test-only PATH wrapper. A restricted PATH fixture proves the shell verifier operates with only its declared runtime utilities. This is helper-level evidence, not a clean-host application install, native desktop qualification, production key ceremony or workflow execution.

References: [OpenSSL Ed25519 verification](https://docs.openssl.org/3.0/man1/openssl-pkeyutl/), [GitHub attestation identity verification](https://cli.github.com/manual/gh_attestation_verify), [offline attestation bundles and trusted roots](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/verify-attestations-offline), [GitHub protected environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).
