// Architecture names used by the AppImage/Debian/Flatpak packaging scripts.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ARCHES, archInfo, hostArch, packageNames } from "./native-arch.mjs";
import { TARGETS, assetNames } from "./native-release-auth.mjs";

test("x86_64 package names are the historical ones", () => {
  assert.deepEqual(packageNames("2.1.0", "x86_64"), {
    appimage: "ShadowCode_2.1.0_amd64.AppImage",
    deb: "ShadowCode_2.1.0_amd64.deb",
    runtimeSources: "ShadowCode_2.1.0_appimage-runtime-sources.tar.gz",
    flatpak: "ShadowCode_2.1.0_x86_64.flatpak",
  });
  assert.equal(ARCHES.x86_64.docker, "linux/amd64");
  assert.equal(ARCHES.x86_64.loader, "ld-linux-x86-64.so.2");
});

test("aarch64 package names follow Tauri, Debian and Flatpak", () => {
  assert.deepEqual(packageNames("2.1.0", "aarch64"), {
    appimage: "ShadowCode_2.1.0_aarch64.AppImage",
    deb: "ShadowCode_2.1.0_arm64.deb",
    runtimeSources: "ShadowCode_2.1.0_aarch64_appimage-runtime-sources.tar.gz",
    flatpak: "ShadowCode_2.1.0_aarch64.flatpak",
  });
  assert.equal(ARCHES.aarch64.docker, "linux/arm64");
  assert.equal(ARCHES.aarch64.multiarch, "aarch64-linux-gnu");
  assert.equal(ARCHES.aarch64.loader, "ld-linux-aarch64.so.1");
});

test("aliases resolve and unsupported architectures are refused", () => {
  for (const name of ["x86_64", "amd64", "x64"]) assert.equal(archInfo(name).arch, "x86_64");
  for (const name of ["aarch64", "arm64"]) assert.equal(archInfo(name).arch, "aarch64");
  for (const name of ["riscv64", "armhf", "i686", ""]) assert.throws(() => archInfo(name), /Unsupported architecture/);
});

test("the host decides; SHADOWCODE_ARCH cannot request cross packaging", () => {
  assert.equal(hostArch({}, "x64").arch, "x86_64");
  assert.equal(hostArch({}, "arm64").arch, "aarch64");
  assert.equal(hostArch({ SHADOWCODE_ARCH: "amd64" }, "x64").arch, "x86_64");
  assert.equal(hostArch({ SHADOWCODE_ARCH: "arm64" }, "arm64").arch, "aarch64");
  assert.throws(() => hostArch({ SHADOWCODE_ARCH: "aarch64" }, "x64"), /no cross packaging/);
  assert.throws(() => hostArch({}, "riscv64"), /x86_64 and aarch64/);
});

test("signed release asset names agree with the packaging names", () => {
  for (const info of Object.values(ARCHES)) {
    assert.ok(Object.hasOwn(TARGETS, info.target), info.target);
    const names = packageNames("2.1.0", info.arch);
    assert.deepEqual(assetNames("2.1.0", info.target), [
      ["appimage", names.appimage],
      ["deb", names.deb],
      ["runtime-sources", names.runtimeSources],
    ]);
  }
});

test("the installer and shell verifier name the same targets and packages", async () => {
  const installer = await readFile(new URL("./install-appimage.sh", import.meta.url), "utf8");
  const library = await readFile(new URL("./native-release-auth-lib.sh", import.meta.url), "utf8");
  for (const info of Object.values(ARCHES)) {
    assert.match(installer, new RegExp(`HOST_TARGET=${info.target} PACKAGE_ARCH=${info.appimage} INSTALLED_ARCH=${info.installed} `));
    assert.match(library, new RegExp(`${info.target}\\) TARGET_APPIMAGE=${info.appimage} TARGET_DEB=${info.deb} TARGET_SOURCES=${info.runtimeSources} `));
  }
});

test("the AppImage runtime build and launcher handle both architectures", async () => {
  const build = await readFile(new URL("../packaging/native-runtime/build.sh", import.meta.url), "utf8");
  assert.match(build, /x86_64\|aarch64\) ;;/);
  assert.doesNotMatch(build, /out\/runtime-x86_64/);
  const apprun = await readFile(new URL("../packaging/native-app-run.sh", import.meta.url), "utf8");
  assert.match(apprun, /shadowcode_multiarch=x86_64-linux-gnu/);
  assert.match(apprun, /usr\/lib\/aarch64-linux-gnu/);
  const docker = await readFile(new URL("./clean-host-runtime.Dockerfile", import.meta.url), "utf8");
  assert.match(docker, /FROM --platform=linux\/amd64 debian@sha256:[a-f0-9]{64} AS debian-amd64/);
  assert.match(docker, /FROM --platform=linux\/arm64 debian@sha256:[a-f0-9]{64} AS debian-arm64/);
  // BuildKit's own TARGETARCH must select the stage; a default would override it.
  assert.match(docker, /^ARG TARGETARCH$/m);
  assert.doesNotMatch(docker, /ARG TARGETARCH=/);
});
