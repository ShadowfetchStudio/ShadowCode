#!/usr/bin/env python3
"""Build ShadowCode from source inside GNOME's SDK and export a .flatpak.

The preparation stage fetches locked dependencies; flatpak-builder's actual
build is offline. Existing source/cache directories are retained for retries.
No application/profile is replaced by default; --install opts into user install.
"""
import argparse
import hashlib
import json
import os
import platform
from pathlib import Path
import shutil
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parent.parent
APP_ID = "com.shadowfetch.shadowcode"
# Flatpak architecture names; amd64/arm64 are accepted as aliases.
ARCHES = {"x86_64": "x86_64", "amd64": "x86_64", "aarch64": "aarch64", "arm64": "aarch64"}


def host_arch():
    machine = platform.machine()
    if machine not in ARCHES:
        raise SystemExit(f"Unsupported build host architecture: {machine}")
    return ARCHES[machine]


def run(args, **kwargs):
    print("+ " + " ".join(map(str, args)), flush=True)
    return subprocess.run(list(map(str, args)), cwd=ROOT, check=True, **kwargs)


def archive(destination, source, names):
    # Canonical metadata removes host ownership and timestamps from inputs.
    def canonical(info):
        info.uid = info.gid = info.mtime = 0
        info.uname = info.gname = ""
        return info
    temporary = destination.with_suffix(destination.suffix + ".new")
    with tarfile.open(temporary, "w:gz", compresslevel=1) as output:
        for name in sorted(names):
            output.add(source / name, arcname=str(name), filter=canonical)
    temporary.replace(destination)


def checkout(directory, url, revision):
    if not (directory / ".git").is_dir():
        directory.mkdir(parents=True, exist_ok=True)
        run(["git", "init", directory])
        run(["git", "-C", directory, "remote", "add", "origin", url])
    available = subprocess.run(["git", "-C", str(directory), "cat-file", "-e", revision], capture_output=True)
    if available.returncode:
        run(["git", "-C", directory, "fetch", "--depth", "1", "origin", revision])
    run(["git", "-C", directory, "checkout", "--detach", revision])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepare-only", action="store_true")
    parser.add_argument("--install", action="store_true")
    parser.add_argument("--skip-fetch", action="store_true", help="Reuse already prepared locked dependency caches")
    parser.add_argument("--arch", choices=sorted(ARCHES), help="Flatpak architecture (default: the build host's; x86_64 or aarch64)")
    parser.add_argument("--state-dir", help="flatpak-builder state/cache directory (default: target/flatpak/state-v2-final)")
    parser.add_argument("--install-deps-from", metavar="REMOTE", help="Let flatpak-builder install the GNOME SDK and extensions from REMOTE (e.g. flathub)")
    parser.add_argument("--cpu-only-llama", action="store_true", help="Build the bundled llama.cpp without the Vulkan module (faster CI builds; not for releases)")
    args = parser.parse_args()
    arch = ARCHES[args.arch] if args.arch else host_arch()
    for tool in ["flatpak", "flatpak-builder", "cargo", "npm", "git"]:
        if shutil.which(tool) is None:
            parser.error(f"Missing build tool: {tool}")
    version = json.loads((ROOT / "src-tauri/tauri.conf.json").read_text())["version"]
    work = ROOT / "target/flatpak"
    caches = ROOT / "target/flatpak-sources"
    work.mkdir(parents=True, exist_ok=True)
    caches.mkdir(parents=True, exist_ok=True)
    if not args.skip_fetch:
        run(["npm", "--prefix", "ui", "ci", "--ignore-scripts", "--cache", caches / "npm-cache"])
        with (work / "vendor-config.toml").open("w") as output:
            run(["cargo", "vendor", "--locked", "--versioned-dirs", caches / "cargo-vendor"], stdout=output)
    vendor = caches / "cargo-vendor"
    npm_cache = caches / "npm-cache"
    if not vendor.is_dir() or not npm_cache.is_dir():
        parser.error("Dependency caches missing; rerun without --skip-fetch")
    pin = dict(line.split("=", 1) for line in (ROOT / "tools/llama.cpp.pin").read_text().splitlines() if "=" in line)
    checkout(ROOT / "tools/llama.cpp", pin["url"], pin["commit"])
    checkout(ROOT / "tools/spirv-headers", "https://github.com/KhronosGroup/SPIRV-Headers.git", pin["spirv_headers_commit"])

    tracked = run(["git", "ls-files", "-z"], stdout=subprocess.PIPE).stdout.decode().split("\0")
    files = {name for name in tracked if name and (ROOT / name).is_file()}
    # Local changes are deliberately included; About records -dirty rather
    # than misrepresenting a modified tree as the original signed release.
    files.update(str(p.relative_to(ROOT)) for p in (ROOT / "packaging/flatpak").rglob("*") if p.is_file())
    files.update({"scripts/build-flatpak.py", "scripts/test-flatpak-host.py", "scripts/test-flatpak-package.mjs", "native/core/src/flatpak.rs", "native/core/tests/remote_security_regressions.rs", "docs/FLATPAK.md"})
    snapshot = work / "source"
    if snapshot.exists():
        shutil.rmtree(snapshot)
    for name in sorted(files):
        destination = snapshot / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / name, destination)
    config = snapshot / ".cargo/config.toml"
    config.write_text(config.read_text() + '\n[source.crates-io]\nreplace-with = "flatpak-vendor"\n[source.flatpak-vendor]\ndirectory = "cargo-vendor"\n')
    source_archive = work / "source.tar.gz"
    archive(source_archive, snapshot, [Path(n) for n in files])
    dependency_archives = []
    archive_inputs = {
        "cargo-vendor": hashlib.sha256((ROOT / "Cargo.lock").read_bytes()).hexdigest(),
        "npm-cache": hashlib.sha256((ROOT / "ui/package-lock.json").read_bytes()).hexdigest(),
        "llama": pin["commit"], "spirv-headers": pin["spirv_headers_commit"],
    }
    input_record = work / "archive-inputs.json"
    previous_inputs = json.loads(input_record.read_text()) if input_record.exists() else {}
    for name, directory, dest in [
        ("cargo-vendor", vendor, "cargo-vendor"),
        ("npm-cache", npm_cache, ".npm-cache"),
        ("llama", ROOT / "tools/llama.cpp", "tools/llama.cpp"),
        ("spirv-headers", ROOT / "tools/spirv-headers", "tools/spirv-headers"),
    ]:
        packed = work / f"{name}.tar.gz"
        if not packed.exists() or previous_inputs.get(name) != archive_inputs[name]:
            archive(packed, directory, [Path(p.name) for p in directory.iterdir() if p.name not in {".git", "build", "_logs"}])
        dependency_archives.append((packed, dest))
    input_record.write_text(json.dumps(archive_inputs, indent=2) + "\n")
    sources = []
    for packed, dest in [(source_archive, "."), *dependency_archives]:
        sources.append({"type": "archive", "path": packed.name, "sha256": hashlib.sha256(packed.read_bytes()).hexdigest(), "strip-components": 0, "dest": dest})
    manifest = json.loads((ROOT / "packaging/flatpak/com.shadowfetch.shadowcode.json").read_text())
    manifest["modules"][0]["sources"] = sources
    sdk_cache = work / "sdk-cargo-cache"
    sdk_cache.mkdir(exist_ok=True)
    native_cache = work / "sdk-native-cache"
    native_cache.mkdir(exist_ok=True)
    manifest["build-options"]["env"]["CARGO_TARGET_DIR"] = str(sdk_cache)
    manifest["build-options"]["env"]["SHADOWCODE_NATIVE_CACHE"] = str(native_cache)
    manifest["build-options"]["build-args"] = ["--filesystem=" + str(sdk_cache), "--filesystem=" + str(native_cache)]
    commit = run(["git", "rev-parse", "HEAD"], stdout=subprocess.PIPE).stdout.decode().strip()
    dirty = run(["git", "status", "--porcelain", "--untracked-files=no"], stdout=subprocess.PIPE).stdout.strip()
    manifest["build-options"]["env"]["SHADOWCODE_COMMIT"] = commit + ("-dirty" if dirty else "")
    if args.cpu_only_llama:
        manifest["build-options"]["env"]["SHADOWCODE_LLAMA_VULKAN"] = "0"
    generated = work / f"{APP_ID}.json"
    generated.write_text(json.dumps(manifest, indent=2) + "\n")
    (work / "SOURCE-INPUTS.json").write_text(json.dumps({"version": version, "commit": commit, "dirty": bool(dirty), "sources": sources, "runtime": "org.gnome.Platform//50", "arch": arch}, indent=2) + "\n")
    if args.prepare_only:
        return
    state_dir = Path(args.state_dir).expanduser().resolve() if args.state_dir else work / "state-v2-final"
    builder = ["flatpak-builder", "--user", "--disable-rofiles-fuse", "--keep-build-dirs", "--force-clean", "--arch=" + arch, "--repo=" + str(work / "repo"), "--state-dir=" + str(state_dir)]
    if args.install_deps_from:
        builder.append("--install-deps-from=" + args.install_deps_from)
    run([*builder, work / "build", generated])
    bundle = work / f"ShadowCode_{version}_{arch}.flatpak"
    run(["flatpak", "build-bundle", "--arch=" + arch, "--runtime-repo=https://flathub.org/repo/flathub.flatpakrepo", work / "repo", bundle, APP_ID])
    (work / "SHA256SUMS").write_text(hashlib.sha256(bundle.read_bytes()).hexdigest() + "  " + bundle.name + "\n")
    if args.install:
        run(["flatpak", "install", "--user", "--noninteractive", bundle])
    print(f"Built {bundle}", flush=True)


if __name__ == "__main__":
    main()
