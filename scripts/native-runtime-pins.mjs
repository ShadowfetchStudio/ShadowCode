// Validate the APK/source locks without selecting replacement versions.
import assert from "node:assert/strict";

export function runtimePins(text, arch) {
  assert.ok(["aarch64", "x86_64"].includes(arch), `Unsupported APK architecture: ${arch}`);
  const base = new Map(), overrides = new Map();
  for (const line of text.trim().split(/\r?\n/)) {
    const match = /^(?:(aarch64|x86_64):)?([a-z0-9][a-z0-9+_.-]*)=([0-9][a-zA-Z0-9._+]*-r\d+)$/.exec(line);
    assert.ok(match, `APK pin must be exact: ${line}`);
    const [, target, name, version] = match;
    const pins = target ? overrides : base;
    const key = target ? `${target}:${name}` : name;
    assert.ok(!pins.has(key), `Duplicate APK pin: ${key}`);
    pins.set(key, version);
  }
  for (const [key, version] of overrides) {
    const [target, name] = key.split(":");
    assert.ok(base.has(name), `Override names no pinned package: ${key}`);
    if (target === arch) base.set(name, version);
  }
  return base;
}

const linkedPackages = {
  gcc: ["gcc", "libgcc", "libstdc++", "libstdc++-dev"],
  musl: ["musl-dev"],
  mimalloc2: ["mimalloc2", "mimalloc2-dev", "mimalloc2-insecure"],
  zlib: ["zlib-dev", "zlib-static"],
  zstd: ["zstd", "zstd-dev", "zstd-libs", "zstd-static"],
};

export function validateRuntimeSourcePins(text, sources) {
  assert.equal(sources.schema, 1);
  assert.deepEqual(sources.packages.map(p => p.name).sort(), Object.keys(linkedPackages).sort(), "Every linked Alpine dependency needs retained sources");
  for (const arch of ["aarch64", "x86_64"]) {
    const pins = runtimePins(text, arch);
    for (const source of sources.packages) {
      for (const name of linkedPackages[source.name])
        assert.equal(pins.get(name), source.version, `${arch}: ${name} differs from retained ${source.name} sources`);
      assert.match(source.aportsCommit, /^[a-f0-9]{40}$/);
      const names = source.files.map(file => file.file);
      assert.equal(new Set(names).size, names.length, `${source.name}: duplicate source file`);
      assert.ok(names.includes("APKBUILD") && names.includes(source.archive), `${source.name}: recipe and archive required`);
      for (const file of source.files) {
        assert.match(file.sha512, /^[a-f0-9]{128}$/);
        assert.ok(!/[\\/]/.test(file.file) && file.file !== "..", "Safe retained source filename");
        const url = new URL(file.url);
        assert.equal(url.protocol, "https:");
        if (file.file === "APKBUILD" || url.hostname === "raw.githubusercontent.com") {
          assert.equal(url.hostname, "raw.githubusercontent.com");
          assert.ok(url.pathname.startsWith(`/alpinelinux/aports/${source.aportsCommit}/`), `${source.name}: recipe/patch must match its immutable aports commit`);
        }
      }
    }
  }
}

// Expected provenance comes from our lock mapping, never from untrusted index
// metadata: an absent/wrong origin must not turn a linked-library check off.
export function runtimeIndexError(name, record, sources) {
  if (!record) return "exact pin missing from official indexes";
  const expected = Object.entries(linkedPackages).find(([, packages]) => packages.includes(name))?.[0];
  if (!expected) return null; // Build tools only require the exact available pin.
  if (record.o !== expected) return `APK origin must be ${expected}`;
  const source = sources.packages.find(source => source.name === expected);
  if (!source || source.aportsCommit !== record.c) return "retained recipe differs from APK build commit";
  return null;
}
