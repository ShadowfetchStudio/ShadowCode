# ShadowCode 2.2 Flatpak

The Flatpak runs the native GTK/WebKit desktop, application engine, SQLite
profile, and bundled CPU/Vulkan llama.cpp runtime on GNOME Platform 50. It is
an x86_64 or aarch64 package built from source inside the SDK on a host of
the same architecture. From 2.2.0 every GitHub release carries both bundles
(`.github/workflows/release-flatpak.yml` builds, installs and starts them
from the release tag) with their SHA-256 checksums in
`ShadowCode_VERSION_flatpak.sha256`. They are checked by that checksum, not
by the publisher signature the AppImage and deb carry. It is not listed on
Flathub.

## Install the bundle

Download the bundle for your computer and the checksum file from the
release, then:

```sh
sha256sum --check --ignore-missing ShadowCode_2.3.0_flatpak.sha256
flatpak install --user ./ShadowCode_2.3.0_x86_64.flatpak
flatpak run com.shadowfetch.shadowcode
```

On 64-bit ARM, install `ShadowCode_2.3.0_aarch64.flatpak` instead.

The bundle points to Flathub for the GNOME runtime. Installation exports the
application launcher and icons into the desktop's Applications menu.

For the CLI, put arguments after the application ID:

```sh
flatpak run com.shadowfetch.shadowcode --version
flatpak run com.shadowfetch.shadowcode status --json
```

## Host tools and data

This developer application can access host projects and spawn the user's
tools through `flatpak-spawn --host`. Its manifest requests filesystem access
and permission to talk to `org.freedesktop.Flatpak`; the Flatpak container is
therefore not a security boundary against commands the user approves.

At launch, ShadowCode checks for host Git, bubblewrap, ripgrep, Node, Python,
and supported coding CLIs. Only tools actually installed on the host are
registered. Vendor commands retain their own sign-ins; provider API keys are
scrubbed by the existing vendor runner before the host bridge receives its
environment. Package-specific loader and profile variables are not passed
to host programs. Git and Node are included as fallbacks.

A small host helper owns each command and its descendants. Stop/Cancel and
application termination close its liveness pipe, which cleans up detached
children as well as the command itself. Its source is included under
`/app/share/licenses/shadowcode/host-monitor.c`; it can be relinked inside
the matching SDK with `cc -static -Os host-monitor.c -o shadowcode-host-monitor`.
The package includes the SDK's glibc, GCC, and Git license notices.

Agent shell commands require working bubblewrap on the host. Network off
uses bubblewrap's private network namespace; network on leaves network
access enabled. Hostname allow-list mode runs the command in a host
bubblewrap with its own private network namespace (`--unshare-net`); the
packaged `shadowcode-proxy-relay` (built statically from
`packaging/flatpak/proxy-relay.c`, source under
`/app/share/licenses/shadowcode/proxy-relay.c`) forwards loopback port 3128
to ShadowCode's allow-list proxy over a Unix socket in
`$XDG_RUNTIME_DIR/app/com.shadowfetch.shadowcode`. If the relay, the shared
socket, or its startup probe is unavailable, the command is refused rather
than run with wider access. See [NATIVE_SANDBOX.md](NATIVE_SANDBOX.md).

Flatpak stores its application profile below
`~/.var/app/com.shadowfetch.shadowcode`. Existing AppImage/Debian profile
files are retained. To move conversations and settings, use ShadowCode's
Your data backup/restore workflow; copying a live SQLite file by hand can
lose its WAL transactions. Vendor sign-ins and existing model files can
remain in their host locations.

## Build from source

Install `flatpak`, `flatpak-builder`, Python 3, Git, Node 22.12 or newer,
and Rust 1.95 or newer on the build host. Add the Flathub user remote if it
is absent, then install the SDK and its extensions:

```sh
flatpak install --user flathub org.gnome.Platform//50 org.gnome.Sdk//50 \
  org.freedesktop.Sdk.Extension.rust-stable//25.08 \
  org.freedesktop.Sdk.Extension.node24//25.08 \
  org.freedesktop.Sdk.Extension.llvm21//25.08
python3 scripts/build-flatpak.py
```

The preparation step fills npm and Cargo caches from their lockfiles and
checks out the pinned llama.cpp and SPIRV-Headers commits. The SDK build
then runs without network access. It compiles the UI, native desktop, all
CPU inference variants, and Vulkan backend; validates AppStream metadata;
and includes project, dependency, SDK standard-library, and inference
runtime license notices.

Outputs are under `target/flatpak/`: the `.flatpak`, `SHA256SUMS`, resolved
manifest, OSTree repository, source snapshots and `SOURCE-INPUTS.json`.
Prepared source archives carry SHA-256 hashes. The SDK Cargo cache is
separate from host build artifacts; application inputs are hashed before
cache reuse because source snapshots use canonical timestamps. Changed
application code is rebuilt; packaging-only retries retain the finished link.

Use `--prepare-only` to prepare inputs, `--skip-fetch` to reuse prepared
dependency caches, or `--install` to install the finished bundle for the
current user. The bundle is built for the host architecture
(`ShadowCode_VERSION_x86_64.flatpak` or `ShadowCode_VERSION_aarch64.flatpak`);
`--arch` names it explicitly and is passed to flatpak-builder, which needs
QEMU user emulation for a foreign architecture. `--state-dir DIR` moves
flatpak-builder's cache (CI uses `~/.flatpak-builder`),
`--install-deps-from=flathub` lets flatpak-builder install the SDK and
extensions itself, and `--cpu-only-llama` skips the Vulkan module for faster
test builds (the runtime then records `backend=cpu`; never ship such a bundle).

Pull requests that change `packaging/`, `scripts/`, `src-tauri/`, `native/` or
the workflows run the `flatpak` job in `.github/workflows/ci.yml`: a
CPU-only-llama build with the GNOME 50 SDK, then install and start the bundle. SDK extensions and the host compiler may differ; the
packaged notices identify the compiler that actually built the app.

After installing, verify command ownership with:

```sh
python3 scripts/test-flatpak-host.py com.shadowfetch.shadowcode \
  --output artifacts/flatpak/bridge-cancellation.json
```

This checks arguments, stdin/stdout, exit status, detached jobs, and cleanup
within three seconds of cancellation.

Exercise the installed native engine, a deterministic model-response fixture,
host tools, bubblewrap, and the interactive terminal in an isolated profile:

```sh
flatpak run --command=/app/bin/node com.shadowfetch.shadowcode \
  "$PWD/scripts/test-flatpak-package.mjs" "$PWD/artifacts/flatpak/package-qa"
```

GitHub release publication and Flathub submission require their own
publisher/review steps. The existing signed AppImage release trust metadata
has not been widened to authorize a new 2.0 release key.
