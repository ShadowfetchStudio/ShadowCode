// Package each format from the original executable. The bundler patches its
// bundle type into the binary; reusing an already patched binary loses that tag.
import { execFile, spawn } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdtemp,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  RUNTIME_LOCATION,
  addRuntimeToDeb,
  copyManagedRuntime,
  readManagedRuntime,
} from "./llama-runtime.mjs";
import { applicationNotices, appdirNotices } from "./native-notices.mjs";
import {
  applyPackagingPath,
  bundleEnvironment,
  installPinnedGtkPlugin,
} from "./native-packaging-env.mjs";
import { buildRuntime, runtimeNotices } from "./native-runtime.mjs";
import {
  METAINFO_FILE,
  normalizeDesktopEntry,
} from "./native-desktop-metadata.mjs";
import { finishDebianPackage } from "./native-deb.mjs";
import { hostArch, packageNames } from "./native-arch.mjs";
import { relocateWebKit } from "./native-webkit-paths.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const packagingPath = applyPackagingPath(root);
console.log(`Using sanitized packaging PATH: ${packagingPath}`);
const cli = path.join(root, "ui/node_modules/@tauri-apps/cli/tauri.js");
const exec = promisify(execFile);
async function command(binary, args, env = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, ...env },
    });
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      code === 0
        ? resolve()
        : reject(new Error(`${binary} failed (${signal || code})`)),
    );
  });
}
const run = (args, env = {}) => command(process.execPath, [cli, ...args], env);
if (process.platform !== "linux")
  throw new Error("This packaging workflow supports Linux x86_64 and aarch64");
// Packages are built natively on each architecture (no cross packaging).
const arch = hostArch();
const version = JSON.parse(
  await readFile(path.join(root, "src-tauri/tauri.conf.json"), "utf8"),
).version;
const names = packageNames(version, arch.arch);
console.log(`Packaging for ${arch.arch} (${arch.target})`);
// Settings › About shows the commit. A distribution building from a source
// archive without Git history may set SHADOWCODE_COMMIT itself.
if (!process.env.SHADOWCODE_COMMIT) {
  try {
    const head = (
      await exec("git", ["rev-parse", "--verify", "HEAD"], { cwd: root })
    ).stdout.trim();
    const changed = (
      await exec("git", ["status", "--porcelain", "--untracked-files=no"], {
        cwd: root,
      })
    ).stdout.trim();
    process.env.SHADOWCODE_COMMIT = changed ? `${head}-dirty` : head;
  } catch {
    console.log("No Git checkout: the build records no commit");
  }
}
if (process.env.SHADOWCODE_COMMIT)
  console.log(`Recording commit ${process.env.SHADOWCODE_COMMIT}`);
for (const name of ["SHADOWCODE_UPDATE_CHECK", "SHADOWCODE_UPDATE_MESSAGE"])
  if (process.env[name])
    console.log(`Update check build switch: ${name}=${process.env[name]}`);
// Fail before the long release build when the managed runtime is missing,
// was built from another commit, or lacks its pinned notices.
const llama = await readManagedRuntime(root);
console.log(
  `Bundling managed llama.cpp ${llama.commit} (${llama.backend}) as /${RUNTIME_LOCATION}`,
);
const notices = path.join(root, "target/native-notices");
const nativeRuntime = await buildRuntime(arch.arch);
await applicationNotices(notices, llama);
const files = {
  "/usr/share/doc/shadowcode/notices": notices,
  [`/usr/share/metainfo/${METAINFO_FILE}`]: path.join(
    root,
    `packaging/${METAINFO_FILE}`,
  ),
};
const config = JSON.stringify({
  bundle: {
    useLocalToolsDir: true,
    linux: { deb: { files }, appimage: { files } },
  },
});
// Tauri would fetch the GTK plugin from upstream master when it is missing.
await installPinnedGtkPlugin(root);
const executable = path.join(root, "target/release/shadowcode");
const unbundledMarker = Buffer.from("__TAURI_BUNDLE_TYPE_VAR_UNK");
try {
  if (!(await readFile(executable)).includes(unbundledMarker)) {
    // Recover after an interrupted bundle or a direct `tauri build`. Cargo
    // cannot detect the bundler's in-place patch in its cached executable.
    await command("cargo", ["clean", "--release", "-p", "shadowcode-desktop"]);
  }
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
await run(["build", "--no-bundle", "--ci", "--", "--locked"]);
if (!(await readFile(executable)).includes(unbundledMarker)) {
  throw new Error("Expected an unbundled Tauri executable before packaging");
}
// Keep the final atomic rename on the same filesystem as the package output.
const scratch = await mkdtemp(path.join(root, "target/.shadowcode-bundle-"));
const original = path.join(scratch, "shadowcode");
await copyFile(executable, original);
try {
  for (const format of ["appimage", "deb"]) {
    await copyFile(original, executable);
    if (format === "appimage") {
      // Tauri stages AppImage content in bundle/appimage_deb and copies it
      // into a reused AppDir, so files from an earlier build (an old
      // metainfo name, for example) would ship again. Start both empty, as a
      // fresh CI machine does.
      for (const stale of ["appimage_deb", "appimage/ShadowCode.AppDir"])
        await rm(path.join(root, "target/release/bundle", stale), {
          recursive: true,
          force: true,
        });
    }
    await run(
      ["bundle", "--bundles", format, "--ci", "--config", config],
      bundleEnvironment(format, nativeRuntime.runtime),
    );
    if (format === "deb") {
      // The bundler's custom-files copy dereferences symlinks, so the runtime
      // is added to the finished package with its relative SONAME links.
      await addRuntimeToDeb(
        path.join(
          root,
          `target/release/bundle/deb/${names.deb}`,
        ),
        llama,
        scratch,
        {
          run: (binary, args) => command(binary, args),
          normalizeDesktop: true,
          // Copyright, changelog, manual page, completions, icons, lintian
          // overrides, stripped runtime and libc dependency.
          finish: (work) =>
            finishDebianPackage(work, {
              exec: (binary, args, options = {}) =>
                exec(binary, args, { maxBuffer: 64_000_000, ...options }),
            }),
        },
      );
    }
    if (format === "appimage") {
      const appimage = path.join(
        root,
        `target/release/bundle/appimage/${names.appimage}`,
      );
      const appdir = path.join(
        root,
        "target/release/bundle/appimage/ShadowCode.AppDir",
      );
      await normalizeDesktopEntry(appdir, true);
      // A Debian build host can hide absolute helper paths: they exist on CI,
      // but not on Arch/Omarchy. Verify and relocate the actual shipped library.
      await relocateWebKit(appdir, arch.multiarch);
      const runtimeInfo = await exec(appimage, ["--appimage-version"]);
      const runtimeVersion = runtimeInfo.stderr + runtimeInfo.stdout;
      if (!runtimeVersion.includes("/commit/75849dc"))
        throw new Error(
          "AppImage runtime changed; update and verify its dependency notices before packaging",
        );
      await copyFile(
        path.join(root, "packaging/native-app-run.sh"),
        path.join(appdir, "AppRun"),
      );
      await chmod(path.join(appdir, "AppRun"), 0o755);
      await rm(path.join(appdir, "AppRun.wrapped"), { force: true });
      // Copy the runtime before collecting notices so the attribution pass
      // sees exactly what ships.
      await copyManagedRuntime(llama, path.join(appdir, RUNTIME_LOCATION));
      await appdirNotices(appdir);
      await runtimeNotices(appdir, nativeRuntime);
      const repacked = path.join(scratch, path.basename(appimage));
      await command(
        path.join(root, "target/.tauri/linuxdeploy-plugin-appimage.AppImage"),
        ["--appimage-extract-and-run", "--appdir", appdir],
        {
          APPIMAGE_EXTRACT_AND_RUN: "1",
          OUTPUT: repacked,
          ARCH: arch.arch,
          LDAI_RUNTIME_FILE: nativeRuntime.runtime,
        },
      );
      await rename(repacked, appimage);
      const sources = path.join(
        root,
        `target/release/bundle/appimage/${names.runtimeSources}`,
      );
      const pendingSources = path.join(scratch, path.basename(sources));
      await command("tar", [
        "-czf",
        pendingSources,
        "-C",
        nativeRuntime.directory,
        "sources",
        "receipt.json",
        "runtime.map",
        "build-packages.db",
        "build-packages.txt",
        "compiler.txt",
        "runtime-dynamic.txt",
        `runtime-${arch.arch}.debug`,
      ]);
      await rename(pendingSources, sources);
    }
  }
} finally {
  await copyFile(original, executable);
  await rm(scratch, { recursive: true, force: true });
}
