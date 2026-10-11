// Signed APT repository builder (scripts/build-apt-repo.mjs), exercised with a
// throwaway GPG key, dummy packages made with dpkg-deb, gpgv and, when
// available, apt-get in a private root. Run: node --test scripts/test-build-apt-repo.mjs
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";
import { KEYRING_NAME, POOL, buildRepository, sourcesFile } from "./build-apt-repo.mjs";

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const has = (cmd) => spawnSync("sh", ["-c", `command -v ${cmd}`]).status === 0;
const needed = ["gpg", "gpgv", "dpkg-deb"].filter((c) => !has(c));
const skip = needed.length ? `missing ${needed.join(", ")}` : false;

async function makeKey(dir, uid) {
  const home = path.join(dir, `gnupg-${uid}`);
  await mkdir(home, { mode: 0o700 });
  const g = (args) => run("gpg", ["--homedir", home, "--batch", "--pinentry-mode", "loopback", "--passphrase", "", ...args]);
  await g(["--quick-gen-key", `${uid} <apt@test.invalid>`, "ed25519", "sign", "1d"]);
  const { stdout } = await g(["--with-colons", "--list-secret-keys"]);
  const fpr = stdout.split("\n").find((l) => l.startsWith("fpr:")).split(":")[9];
  const { stdout: armored } = await g(["--armor", "--export-secret-keys", fpr]);
  return { fpr, armored };
}

async function makeDeb(dir, { pkg = "shadow-code", version, arch, payload = "x" }) {
  const root = path.join(dir, `${pkg}-${version}-${arch}`);
  await mkdir(path.join(root, "DEBIAN"), { recursive: true });
  await mkdir(path.join(root, "usr/share/doc", pkg), { recursive: true });
  await writeFile(path.join(root, "usr/share/doc", pkg, "marker"), `${version} ${payload}\n`);
  await writeFile(
    path.join(root, "DEBIAN/control"),
    `Package: ${pkg}\nVersion: ${version}\nArchitecture: ${arch}\nMaintainer: Test <t@test.invalid>\nDescription: dummy\n`,
  );
  const deb = path.join(dir, `${pkg}_${version}_${arch}-${payload}.deb`);
  await run("dpkg-deb", ["--root-owner-group", "-Zgzip", "--build", root, deb]);
  return deb;
}

async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), "apt-repo-test-"));
  const key = await makeKey(dir, "ShadowCode Test Archive");
  return { dir, key };
}

test("builds a signed repository that gpgv and the index hashes accept", { skip }, async () => {
  const { dir, key } = await setup();
  try {
    const debs = [
      await makeDeb(dir, { version: "2.0.0", arch: "amd64" }),
      await makeDeb(dir, { version: "2.1.0", arch: "amd64" }),
      await makeDeb(dir, { version: "2.1.0", arch: "arm64" }),
    ];
    const out = path.join(dir, "repo");
    await buildRepository({ debs, out, fingerprint: key.fpr, armoredKey: key.armored, date: new Date("2026-10-11T00:00:00Z") });
    const dist = path.join(out, "dists/stable");
    const keyring = path.join(out, `${KEYRING_NAME}.gpg`);
    await run("gpgv", ["--keyring", keyring, path.join(dist, "InRelease")]);
    await run("gpgv", ["--keyring", keyring, path.join(dist, "Release.gpg"), path.join(dist, "Release")]);

    const release = await readFile(path.join(dist, "Release"), "utf8");
    assert.match(release, /^Suite: stable$/m);
    assert.match(release, /^Architectures: amd64 arm64$/m);
    assert.doesNotMatch(release, /Valid-Until/);
    const sha = release.split("SHA256:\n")[1].trim().split("\n");
    assert.equal(sha.length, 6);
    for (const line of sha) {
      const [hash, size, name] = line.trim().split(/\s+/);
      const data = await readFile(path.join(dist, name));
      assert.equal(data.length, Number(size));
      assert.equal(createHash("sha256").update(data).digest("hex"), hash);
    }
    const amd = gunzipSync(await readFile(path.join(dist, "main/binary-amd64/Packages.gz"))).toString();
    assert.equal((amd.match(/^Package: shadow-code$/gm) || []).length, 2);
    for (const m of amd.matchAll(/^Filename: (.*)\nSize: (\d+)\nMD5sum: .*\nSHA256: (.*)$/gm)) {
      const data = await readFile(path.join(out, m[1]));
      assert.equal(data.length, Number(m[2]));
      assert.equal(createHash("sha256").update(data).digest("hex"), m[3]);
    }
    const arm = await readFile(path.join(dist, "main/binary-arm64/Packages"), "utf8");
    assert.match(arm, /^Filename: pool\/main\/s\/shadow-code\/shadow-code_2\.1\.0_arm64\.deb$/m);
    assert.equal(await readFile(path.join(out, "shadowcode.sources"), "utf8"), sourcesFile());
    const files = await readdir(out);
    assert.ok(!files.some((f) => /secret|private/i.test(f)));
    assert.doesNotMatch(await readFile(path.join(out, `${KEYRING_NAME}.asc`), "utf8"), /PRIVATE/);

    // A tampered index no longer matches the signed Release.
    const tampered = path.join(dir, "Release.tampered");
    await writeFile(tampered, release.replace("Suite: stable", "Suite: unstable"));
    await assert.rejects(run("gpgv", ["--keyring", keyring, path.join(dist, "Release.gpg"), tampered]));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("refuses a mismatched key, foreign packages and conflicting pool files", { skip }, async () => {
  const { dir, key } = await setup();
  try {
    const out = path.join(dir, "repo");
    const good = await makeDeb(dir, { version: "2.1.0", arch: "amd64" });
    const other = await makeKey(dir, "Other");
    await assert.rejects(
      buildRepository({ debs: [good], out, fingerprint: key.fpr, armoredKey: other.armored }),
      /does not match the pinned/,
    );
    await assert.rejects(buildRepository({ debs: [good], out, fingerprint: key.fpr.toLowerCase(), armoredKey: key.armored }), /fingerprint/);
    await assert.rejects(buildRepository({ debs: [good], out, fingerprint: key.fpr, armoredKey: "" }), /secret key/);
    const foreign = await makeDeb(dir, { pkg: "evil", version: "1.0", arch: "amd64" });
    await assert.rejects(buildRepository({ debs: [foreign], out, fingerprint: key.fpr, armoredKey: key.armored }), /is not shadow-code/);
    const i386 = await makeDeb(dir, { version: "2.1.0", arch: "i386" });
    await assert.rejects(buildRepository({ debs: [i386], out, fingerprint: key.fpr, armoredKey: key.armored }), /architecture i386/);

    // --previous keeps older pool entries but refuses changed bytes under the same name.
    const old = await makeDeb(dir, { version: "2.0.0", arch: "amd64" });
    const first = path.join(dir, "first");
    await buildRepository({ debs: [old], out: first, fingerprint: key.fpr, armoredKey: key.armored });
    const merged = await buildRepository({ debs: [good], out, fingerprint: key.fpr, armoredKey: key.armored, previous: first });
    assert.deepEqual(merged.packages, ["shadow-code_2.0.0_amd64.deb", "shadow-code_2.1.0_amd64.deb"]);
    const changed = await makeDeb(dir, { version: "2.0.0", arch: "amd64", payload: "changed" });
    await assert.rejects(
      buildRepository({ debs: [changed], out: path.join(dir, "again"), fingerprint: key.fpr, armoredKey: key.armored, previous: first }),
      /differs from an existing package/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Valid-Until is opt-in and the CLI reads the key from the environment", { skip }, async () => {
  const { dir, key } = await setup();
  try {
    const deb = await makeDeb(dir, { version: "2.1.0", arch: "arm64" });
    const out = path.join(dir, "repo");
    await run(process.execPath, [path.join(here, "build-apt-repo.mjs"), "--out", out, "--fingerprint", key.fpr, "--valid-days", "30", "--date", "2026-10-11T00:00:00Z", deb], {
      env: { ...process.env, APT_REPO_SIGNING_KEY: key.armored },
    });
    const release = await readFile(path.join(out, "dists/stable/Release"), "utf8");
    assert.match(release, /^Date: Sun, 11 Oct 2026 00:00:00 UTC$/m);
    assert.match(release, /^Valid-Until: Tue, 10 Nov 2026 00:00:00 UTC$/m);
    await assert.rejects(
      run(process.execPath, [path.join(here, "build-apt-repo.mjs"), "--out", out, "--fingerprint", key.fpr, deb], { env: { ...process.env, APT_REPO_SIGNING_KEY: "" } }),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("apt-get in a private root trusts only the signed-by keyring and never downgrades", { skip: skip || (!has("apt-get") && "apt-get missing") }, async () => {
  const { dir, key } = await setup();
  try {
    const debs = [await makeDeb(dir, { version: "2.0.0", arch: "amd64" }), await makeDeb(dir, { version: "2.1.0", arch: "amd64" })];
    const out = path.join(dir, "repo");
    await buildRepository({ debs, out, fingerprint: key.fpr, armoredKey: key.armored });

    const root = path.join(dir, "root");
    for (const d of ["etc/apt/sources.list.d", "etc/apt/keyrings", "etc/apt/preferences.d", "etc/apt/apt.conf.d", "var/lib/apt/lists/partial", "var/cache/apt/archives/partial", "var/lib/dpkg"]) {
      await mkdir(path.join(root, d), { recursive: true });
    }
    await writeFile(path.join(root, "var/lib/dpkg/status"), "");
    await writeFile(path.join(root, "etc/apt/sources.list"), "");
    const keyring = path.join(root, "etc/apt/keyrings", `${KEYRING_NAME}.gpg`);
    await writeFile(keyring, await readFile(path.join(out, `${KEYRING_NAME}.gpg`)));
    const sources = sourcesFile(`file:${out}`).replace(`/etc/apt/keyrings/${KEYRING_NAME}.gpg`, keyring).replace("amd64 arm64", "amd64");
    await writeFile(path.join(root, "etc/apt/sources.list.d/shadowcode.sources"), sources);
    const apt = (args) =>
      run("apt-get", [
        "-o", `Dir=${root}`, "-o", "Dir::State::status=" + path.join(root, "var/lib/dpkg/status"),
        "-o", "APT::Architecture=amd64", "-o", "APT::Architectures::=amd64",
        "-o", "Debug::NoLocking=1", "-o", "APT::Sandbox::User=root",
        "-o", "Dir::Etc::trusted=/dev/null", "-o", "Dir::Etc::trustedparts=" + path.join(root, "etc/apt/trusted.gpg.d"),
        ...args,
      ]);
    const { stdout: update, stderr } = await apt(["update"]);
    assert.doesNotMatch(update + stderr, /NO_PUBKEY|not signed|insecure|^W:|^E:/m);
    const { stdout: sim } = await apt(["--simulate", "install", "shadow-code"]);
    assert.match(sim, /Inst shadow-code \(2\.1\.0 /);
    // Downgrades are refused unless the administrator asks for one explicitly.
    await writeFile(path.join(root, "var/lib/dpkg/status"), "Package: shadow-code\nStatus: install ok installed\nVersion: 2.1.0\nArchitecture: amd64\nMaintainer: T <t@test.invalid>\nDescription: dummy\n");
    const { stdout: up } = await apt(["--simulate", "upgrade"]);
    assert.doesNotMatch(up, /Inst shadow-code/);
    await assert.rejects(apt(["--simulate", "-y", "--no-allow-downgrades", "install", "shadow-code=2.0.0"]));

    // A Release signed by another key is rejected.
    const other = await makeKey(dir, "Other");
    await buildRepository({ debs, out, fingerprint: other.fpr, armoredKey: other.armored });
    await rm(path.join(root, "var/lib/apt/lists"), { recursive: true });
    await mkdir(path.join(root, "var/lib/apt/lists/partial"), { recursive: true });
    const res = await apt(["update"]).then((r) => r.stdout + r.stderr, (e) => e.stdout + e.stderr);
    assert.match(res, /NO_PUBKEY|not signed|signature/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

assert.equal(POOL, "pool/main/s/shadow-code");
