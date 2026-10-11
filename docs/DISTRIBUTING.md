# Distributing ShadowCode

This guide is for people who ship ShadowCode to others: Linux distributions
(Shadowfetch Linux first), image builders and system administrators. It
covers which package to ship, how to verify it, what it depends on, how to
turn off the update check, where user data lives, what the first run does,
and the license terms.

## Which package

Each release on [GitHub](https://github.com/ShadowfetchStudio/ShadowCode/releases)
has two packages for x86_64 Linux with glibc 2.39 or newer (Debian 13,
Ubuntu 24.04 and later):

| Package | Use it when |
| --- | --- |
| `ShadowCode_VERSION_amd64.deb` (package name `shadow-code`) | You install system-wide through dpkg/APT. **Recommended for distributions.** |
| `ShadowCode_VERSION_amd64.AppImage` | One user installs it in their home folder with the authenticated installer. It carries its own WebKit and does not need FUSE (`libfuse2`). |

### ARM64 (aarch64)

From 2.1.0 the same packages are built natively for 64-bit ARM (aarch64) on
GitHub's `ubuntu-24.04-arm` runners and pass the same release gates:

| x86_64 | aarch64 |
| --- | --- |
| `ShadowCode_VERSION_amd64.deb` | `ShadowCode_VERSION_arm64.deb` (`Architecture: arm64`) |
| `ShadowCode_VERSION_amd64.AppImage` | `ShadowCode_VERSION_aarch64.AppImage` |
| `ShadowCode_VERSION_appimage-runtime-sources.tar.gz` | `ShadowCode_VERSION_aarch64_appimage-runtime-sources.tar.gz` |
| `ShadowCode_VERSION_x86_64.flatpak` | `ShadowCode_VERSION_aarch64.flatpak` |

The publisher's trust policy (`release/trust/policy`) names both
`x86_64-unknown-linux-gnu` and `aarch64-unknown-linux-gnu`. Each release
publishes both targets' packages, each with its own signed metadata; the
aarch64 files carry an `-aarch64` suffix: `RELEASE-AUTH-aarch64`,
`RELEASE-AUTH-aarch64.sig`, `RELEASE-MANIFEST-aarch64.json` and
`SHA256SUMS-aarch64`. Verify an aarch64 package exactly like an x86_64 one,
naming the aarch64 package; the verifier reads the suffixed metadata itself:

```bash
bash /path/to/trusted-bundle/scripts/verify-native-release.sh \
  --bundle-dir /path/to/downloads \
  --trust-dir /path/to/trusted-bundle/release/trust \
  --artifact ShadowCode_VERSION_arm64.deb \
  --stage-dir ./verified-deb-VERSION
```

Releases before 2.1.0 have no aarch64 packages; build them from source (below)
on an aarch64 machine. Cross-building is not supported: each architecture is built
on its own hardware.

Both contain the same compiled application and the same pinned llama.cpp
runtime. Each release is also indexed in a signed APT repository (see
[APT repository](#apt-repository)); a distribution that ships the `.deb`
itself delivers updates itself (see [Updates](#updates)).

## APT repository

The release workflow publishes `https://shadowfetchstudio.github.io/ShadowCode/apt`
(suite `stable`, component `main`, architectures `amd64 arm64`) from the
`gh-pages` branch. Configure it with a deb822 source and a scoped keyring in
`/etc/apt/keyrings`:

```sh
sudo install -d -m 0755 /etc/apt/keyrings
curl -fsSLo /tmp/shadowcode-archive-keyring.gpg \
  https://shadowfetchstudio.github.io/ShadowCode/apt/shadowcode-archive-keyring.gpg
gpg --show-keys --with-fingerprint /tmp/shadowcode-archive-keyring.gpg
# Compare the fingerprint with release/trust/APT-SIGNING-KEY in a reviewed
# copy of the repository at a release tag; stop if it differs.
sudo install -m 0644 /tmp/shadowcode-archive-keyring.gpg /etc/apt/keyrings/
sudo tee /etc/apt/sources.list.d/shadowcode.sources >/dev/null <<'EOF'
Types: deb
URIs: https://shadowfetchstudio.github.io/ShadowCode/apt
Suites: stable
Components: main
Architectures: amd64 arm64
Signed-By: /etc/apt/keyrings/shadowcode-archive-keyring.gpg
EOF
sudo apt update && sudo apt install shadow-code
```

`shadowcode.sources` in the repository root is the same source file.

The keyring is fetched once, over HTTPS, and must be checked against the
fingerprint in a reviewed copy of the repository: like the AppImage
installer's trust bundle, a key downloaded beside the packages does not
authenticate itself. `Signed-By` scopes the key to this one source; it is not
added to APT's global trusted keys. The repository key is a separate OpenPGP
key from the Ed25519 publisher key: CI indexes only a `.deb` that already
passed `verify-native-release.sh` against `release/trust`, then signs
`InRelease` and `Release.gpg`.

Downgrade and rollback protection comes from APT. It verifies `InRelease` with
the keyring, checks every index and package against the SHA-256 sums in the
signed `Release`, and never replaces an installed version with a lower one
during `apt upgrade`; a downgrade needs an explicit `shadow-code=VERSION` and
`--allow-downgrades`. Earlier versions stay in the pool so an administrator can
roll back deliberately. `Release` carries no `Valid-Until` by default, so a
mirror or network attacker could keep serving an old signed `Release` (a
freeze); that withholds updates but cannot install anything older than what is
installed. The repository is published by the release workflow only; nothing
in ShadowCode adds or contacts it by itself.

`scripts/build-apt-repo.mjs` builds the repository (a plain pool plus
`Packages`, `Release`, `InRelease` and `Release.gpg`, no reprepro needed) and
`scripts/test-build-apt-repo.mjs` checks it with a throwaway key, `gpgv` and
`apt-get` in a private root. From 2.1.0 each release adds both the amd64 and
the arm64 `.deb`, each verified against its own signed envelope first, so one
`.sources` file serves both architectures.

## Verify a release before you ship it

Download the `.deb` together with `SHA256SUMS`, `RELEASE-MANIFEST.json`,
`RELEASE-AUTH` and `RELEASE-AUTH.sig` into one folder. Verify it with the
verifier and public key from a reviewed copy of the ShadowCode repository at
the release tag, never with files that came with the download:

```sh
git clone --depth 1 --branch vVERSION https://github.com/ShadowfetchStudio/ShadowCode trusted
bash trusted/scripts/verify-native-release.sh \
  --bundle-dir /path/to/downloads \
  --trust-dir trusted/release/trust \
  --artifact ShadowCode_VERSION_amd64.deb \
  --stage-dir ./verified-VERSION \
  --expect-version VERSION
```

Ship the verified copy in `verified-VERSION/`, and pin its SHA-256 and size in
your build. The verifier needs only Bash, OpenSSL 3 and coreutils. It checks
the Ed25519 publisher signature over the release envelope, the envelope's
identity (repository, version, tag, commit, target), and the package bytes.
The publisher key ID is
`f0c60ff8228314616985712f8918c9798c0ecf72b7271e19343a041c25663b7f`; the
trust policy in each tagged revision says which versions it covers. Compare
that fingerprint with one you obtained independently.
[RELEASE_AUTHENTICATION.md](RELEASE_AUTHENTICATION.md) has the exact
contract. Checksums alone do not authenticate the publisher.

## Build from source instead

Follow [Build from source](../README.md#build-from-source) and
[RELEASING.md](RELEASING.md) §2–§4: build the pinned llama.cpp runtime, then

```sh
node scripts/build-native.mjs
node scripts/check-native-package.mjs \
  target/release/bundle/appimage/ShadowCode_VERSION_amd64.AppImage \
  target/release/bundle/deb/ShadowCode_VERSION_amd64.deb
```

On an aarch64 host the same commands produce
`ShadowCode_VERSION_aarch64.AppImage` and `ShadowCode_VERSION_arm64.deb`; pass
those names to `check-native-package.mjs`. The AppImage runtime is built in a
`linux/arm64` container from the same pinned Alpine image (a multi-arch
index), so Docker or Podman must run natively there. The llama.cpp runtime's
aarch64 CPU variants include Armv9.2 SME, which needs GCC 14 or newer; on
Ubuntu 24.04 install `gcc-14` and `g++-14` (`scripts/build-llama.cpp.sh` uses
them when the default compiler cannot target `armv9.2-a+sme`), or set
`SHADOWCODE_CC` and `SHADOWCODE_CXX`.

Build-time switches, read from the environment of the build:

| Variable | Effect |
| --- | --- |
| `SHADOWCODE_UPDATE_CHECK=off` | The executable never checks for updates, whatever the user or policy files say. `default-off` only makes "off" the default. |
| `SHADOWCODE_UPDATE_MESSAGE="…"` | Text shown in **Settings › About** instead of update steps, for example "ShadowCode updates arrive with your system updates." |
| `SHADOWCODE_COMMIT` | The commit shown in **Settings › About**. `build-native.mjs` sets it from Git (with `-dirty` for local changes); set it yourself when you build from a source archive. |
| `SHADOWCODE_REQUIRE_LINTIAN=1` | `check-native-package.mjs` fails when `lintian` is not installed instead of skipping it. |

`check-native-package.mjs` also checks what distributions look for in the
`.deb` (next section) and, when they are installed, runs `lintian` (errors
fail) and `desktop-file-validate`.

## What the .deb contains

| Path | What |
| --- | --- |
| `/usr/bin/shadowcode` | The application: desktop window, CLI, TUI, MCP and ACP servers in one executable |
| `/usr/lib/shadowcode/` | The pinned llama.cpp runtime (`llama-server` and its libraries, `COMMIT`, `NOTICES/`) |
| `/usr/share/applications/com.shadowfetch.shadowcode.desktop` | Launcher (`Icon=shadowcode`) |
| `/usr/share/metainfo/com.shadowfetch.shadowcode.appdata.xml` | AppStream metadata, validated with `appstreamcli validate --strict` |
| `/usr/share/icons/hicolor/{16,22,24,32,48,64,96,128,256,512}x…/apps/shadowcode.png`, `…/scalable/apps/shadowcode.svg` | Icons |
| `/usr/share/man/man1/shadowcode.1.gz` | Manual page, generated from the CLI definitions |
| `/usr/share/bash-completion/completions/shadowcode`, `/usr/share/zsh/vendor-completions/_shadowcode`, `/usr/share/fish/vendor_completions.d/shadowcode.fish` | Shell completions (`shadowcode completions bash\|zsh\|fish` prints the same) |
| `/usr/share/doc/shadow-code/copyright`, `changelog.gz` | Machine-readable copyright with the NOTICE; changelog from the AppStream release history |
| `/usr/share/doc/shadowcode/notices/` | License texts of every bundled component, with an inventory (`application.json`) of versions, sources and SHA-256 digests |
| `/usr/share/lintian/overrides/shadow-code` | Two explained overrides (see [Lint status](#lint-status)) |

The package has no maintainer scripts, no conffiles, nothing under `/etc`,
no services and no network access at install time. Installing, removing or
purging it touches only the files above; the release's clean-host check
purges it in a network-disabled Debian 13 container and confirms that the
user's settings, history and projects stay.

### Dependencies

- **Depends:** `git`, `libgomp1`, `libssl3`, `libasound2`,
  `libwebkit2gtk-4.1-0`, `libgtk-3-0`, `libc6 (>= 2.39)`, `libgcc-s1`,
  `libstdc++6`. The libc floor is computed at packaging time from the newest
  glibc symbol version any packaged binary uses. On Debian 13 and Ubuntu
  24.04 the `…t64` libraries provide `libssl3`, `libasound2` and `libgtk-3-0`.
- **Recommends:** `libvulkan1` (GPU inference for local models; the runtime
  falls back to the CPU without it) and `bubblewrap` (the shell sandbox;
  without it ShadowCode uses Landlock and warns).
- **Not packaged:** the vendor command-line tools (Codex, Claude Code, Cursor,
  Grok) that subscription rows drive; users install and sign in to them
  themselves. The Antigravity agent server is downloaded from Google only when
  the user presses **Install** in Settings › Accounts. GGUF models are not
  included.

### Lint status

With lintian 2.117 (`lintian -I --pedantic`), the package built from this
branch has no errors and no warnings. What remains is informational:

- `hardening-no-bindnow` and `hardening-no-fortify-functions` for the
  llama.cpp libraries (upstream's CMake build does not link with `-z now`);
- `spelling-error-in-binary` for strings inside compiled code;
- `binary-has-unneeded-section .comment` for `/usr/bin/shadowcode`;
- `package-contains-documentation-outside-usr-share-doc` for
  `/usr/lib/shadowcode/architectures.txt`, runtime metadata the installer and
  package checks read;
- `possible-documentation-but-no-doc-base-registration`, and the pedantic
  `repeated-path-segment` for `node_modules` in the npm notice paths.

Two overrides ship in the package: `embedded-library libyaml` (the executable
contains unsafe-libyaml, a Rust translation of libyaml; there is no system
library to link) and `extra-license-file` for the third-party license texts
under `/usr/share/doc/shadowcode/notices`, which are kept for attribution.

The package strips the runtime's binaries and gives its shared libraries mode
0644, the way `dh_strip` and `dh_fixperms` would.

## Updates

### The update notice

ShadowCode checks for a newer release at most once a day while its window is
open, and when the user presses **Check now** in **Settings › About**. It
sends one HTTPS `GET` to
`https://api.github.com/repos/ShadowfetchStudio/ShadowCode/releases/latest` with
the fixed `User-Agent: ShadowCode-update-check`. The request has no query
string and carries no version, account, token, cookie or other identifier.
ShadowCode sends no telemetry.

If GitHub reports a newer stable release, a small **Update available** button
appears in the status bar. **Settings › About** shows the version, a link to
the release notes and what to do next, chosen by how ShadowCode was installed:

| Installed as | Next step shown |
| --- | --- |
| AppImage | Download the AppImage and its four signature files, then run the authenticated installer. The installer verifies the signature before it runs anything. |
| Debian package | `apt upgrade` from the ShadowCode APT repository, or the distribution's updates; a `.deb` installed by hand is verified with the trusted verifier and installed with apt. |
| Other system package | Update through the package manager. |
| Built from source | `git fetch --tags && git checkout vVERSION`, then build. |

ShadowCode never downloads, verifies or installs an update by itself.
Network mode **Offline** pauses the check. A failed check is recorded quietly
and shown only in Settings › About; the next attempt is a day later.

### Turning it off

Strongest first:

1. **At build time:** `SHADOWCODE_UPDATE_CHECK=off` (see above).
2. **At package or install time:** a system policy file. ShadowCode reads
   `<prefix>/share/shadowcode/policy.yaml` next to its executable
   (`/usr/share/shadowcode/policy.yaml` for `/usr/bin/shadowcode`), then
   `/etc/shadowcode/policy.yaml`, which wins:

   ```yaml
   updates:
     check: false      # never check; users cannot turn it back on
     # default: false  # alternatively: off unless the user turns it on
     message: "ShadowCode updates arrive with Shadowfetch Linux updates."
   ```

   The `shadow-code` package does not own either path, so a distribution
   package or an installer can provide one. A policy file that exists but
   cannot be read (bad YAML, a misspelt key, too large) also turns checks
   off, and Settings › About says which file to fix.
3. **Per user:** the **Check for updates once a day** switch in Settings ›
   About, stored as `updates.check: false` in
   `~/.config/shadow-agent/config.yaml` (`shadowcode config updates.check false`
   from a terminal).

With checks turned off by the build or a policy, Settings › About shows the
policy's message and no **Check now** button.

## Defaults and user data

ShadowCode has no system-wide settings file besides the update policy. Each
user's settings are created on first run. To give new accounts different
defaults, put a partial `config.yaml` in `/etc/skel/.config/shadow-agent/`,
for example for an offline-first edition:

```yaml
network:
  mode: offline        # only models on this computer; no vendor status checks
updates:
  check: false
```

Keys that are not set keep ShadowCode's defaults, and first-run setup keeps
what the file sets. This affects only accounts created afterwards; use the
policy file for the update check.

| What | Where |
| --- | --- |
| Settings | `~/.config/shadow-agent/config.yaml` |
| API keys for HTTP providers | `~/.config/shadow-agent/secrets.env` (mode 600) |
| Remote access and paired devices | `~/.config/shadow-agent/remote.json` (mode 600) |
| Conversations, jobs, history (SQLite) | `~/.local/state/shadow-agent/` |
| The update check's last answer | `~/.local/state/shadow-agent/update-check.json` |
| Webview storage, voice and code-intelligence models | `~/.local/share/shadow-agent/` |
| Antigravity agent server and its sign-in | `~/.local/share/shadowcode/antigravity-acp/` |
| AppImage installs only: the app, the runtime and installer state | `~/Applications/ShadowCode.AppImage`, `~/.local/lib/shadowcode`, `~/.local/lib/.shadowcode-release-state` |
| Per project | `<project>/.shadow/` |

These folders follow `XDG_CONFIG_HOME`, `XDG_STATE_HOME` and `XDG_DATA_HOME`.
Removing or purging the package leaves all of them in place; a user who wants
a clean slate deletes them.

## First run

- Nothing needs the network. Installing the `.deb` and opening the window work
  offline; the release gate installs both packages in a network-disabled
  Debian 13 container and opens the first window.
- The first window asks for a project folder (and whether to trust it) and a
  permission mode. It does not probe vendor tools or model servers.
- About 15 seconds after the window opens, the update check runs once if it is
  allowed and on. Offline, it fails quietly.
- Local models need a GGUF file the user adds or imports from an Ollama
  store; the llama.cpp runtime ships in the package and uses Vulkan when
  available.

## Licenses

ShadowCode is licensed under the Apache License 2.0; releases up to 0.31.0
were MIT. Copyright 2026 Shadowfetch. The [NOTICE](../NOTICE), which credits
Shadowfetch as ShadowCode's original creator, must accompany every copy and
every modified version (section 4(d)); mark files you change. The license does
not grant use of the name "ShadowCode" for other products (section 6). A
rebuilt or patched package should say so, for example in its changelog and in
`SHADOWCODE_UPDATE_MESSAGE`.

The `.deb` carries the NOTICE in `/usr/share/doc/shadow-code/copyright`, the
full license as `/usr/share/doc/shadowcode/notices/ShadowCode-LICENSE`, and
the license texts of all bundled components under
`/usr/share/doc/shadowcode/notices/`. Settings › About shows the license, the
NOTICE and that folder.

## Shadowfetch Linux

Notes from reading `Shadowfetchapps/shadowfetch-linux` (commit `2c2d5cb`,
4.1.0 "Umbra", a Debian testing derivative). ShadowCode is not part of it
yet, and nothing here changes that repository.

- **How it would fit.** Shadowfetch Linux ships its own packages from a signed
  repository and installs vendor applications only on request, through
  helpers that pin the download's SHA-256 and size and install it with APT
  (`shadowfetch-grok-bot` is the model). ShadowCode's `.deb` fits that
  pattern: pin the verified `.deb` from the GitHub release, check it with the
  ShadowCode verifier as above, and install it with APT. The Welcome catalog
  currently accepts only `apt`, `preset` and `template` entries, so a catalog
  entry would need a helper like that one.
- **Its package gate.** `tools/release/package_gate.py` runs
  `lintian --display-level=error` and `desktop-file-validate`. The `.deb`
  passes both.
- **Updates.** Fireproof is the only updater and nothing installs without
  consent. Ship a `policy.yaml` with a `message` pointing at Shadowfetch
  Linux's updates, and `check: false` if the distribution does not want
  ShadowCode to contact GitHub at all. The Ice (offline) edition should use
  `check: false`; the `/etc/skel` example above makes Offline the default
  network mode too.
- **AppImage.** Shadowfetch Linux does not ship `libfuse2`. ShadowCode's
  AppImage does not need it, but the `.deb` is the better fit.
- **Telemetry.** ShadowCode sends none, which matches the distribution's
  zero-telemetry rule. The only automatic request is the update check above.

What the distribution needs from ShadowCode, and what we keep stable:

- asset names `ShadowCode_VERSION_amd64.deb`, `SHA256SUMS`,
  `RELEASE-MANIFEST.json`, `RELEASE-AUTH`, `RELEASE-AUTH.sig` for every
  signed release;
- package name `shadow-code`, desktop ID `com.shadowfetch.shadowcode`,
  executable `/usr/bin/shadowcode`, profile folders named `shadow-agent`;
- the policy file format above;
- a trust policy in each tagged revision that covers that release. Moving to
  a new version means taking the verifier and trust files from the new tag.
