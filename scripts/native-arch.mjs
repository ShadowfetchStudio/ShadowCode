// One table for every architecture-dependent packaging name. x86_64 values are
// the historical names and must never change; aarch64 follows Tauri's bundler
// (AppImage `_aarch64`, Debian `_arm64`) and Debian/Flatpak conventions.
import assert from "node:assert/strict";

export const ARCHES = Object.freeze({
  x86_64: Object.freeze({
    arch: "x86_64",
    node: "x64",
    target: "x86_64-unknown-linux-gnu",
    deb: "amd64",
    appimage: "amd64",
    // Name of the AppImage once installed under ~/Applications.
    installed: "x86_64",
    flatpak: "x86_64",
    docker: "linux/amd64",
    multiarch: "x86_64-linux-gnu",
    loader: "ld-linux-x86-64.so.2",
    // Historical: x86_64 runtime sources carry no architecture in their name.
    runtimeSources: "appimage-runtime-sources",
  }),
  aarch64: Object.freeze({
    arch: "aarch64",
    node: "arm64",
    target: "aarch64-unknown-linux-gnu",
    deb: "arm64",
    appimage: "aarch64",
    installed: "aarch64",
    flatpak: "aarch64",
    docker: "linux/arm64",
    multiarch: "aarch64-linux-gnu",
    loader: "ld-linux-aarch64.so.1",
    runtimeSources: "aarch64_appimage-runtime-sources",
  }),
});

const ALIASES = { x86_64: "x86_64", amd64: "x86_64", x64: "x86_64", aarch64: "aarch64", arm64: "aarch64" };

/** Resolve an architecture name (x86_64/amd64/x64, aarch64/arm64). */
export function archInfo(name) {
  const key = ALIASES[name];
  assert(key, `Unsupported architecture: ${name}`);
  return ARCHES[key];
}

/** The build host's architecture, or SHADOWCODE_ARCH when it names the same one. */
export function hostArch(env = process.env, nodeArch = process.arch) {
  const host = Object.values(ARCHES).find((info) => info.node === nodeArch);
  assert(host, `This packaging workflow supports Linux x86_64 and aarch64, not ${nodeArch}`);
  if (env.SHADOWCODE_ARCH) {
    // Packages embed host-built binaries; cross packaging is not supported.
    assert.equal(archInfo(env.SHADOWCODE_ARCH).arch, host.arch, "SHADOWCODE_ARCH must match the build host (no cross packaging)");
  }
  return host;
}

export function packageNames(version, arch) {
  const info = archInfo(arch);
  return {
    appimage: `ShadowCode_${version}_${info.appimage}.AppImage`,
    deb: `ShadowCode_${version}_${info.deb}.deb`,
    runtimeSources: `ShadowCode_${version}_${info.runtimeSources}.tar.gz`,
    flatpak: `ShadowCode_${version}_${info.flatpak}.flatpak`,
  };
}
