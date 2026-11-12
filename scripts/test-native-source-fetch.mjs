// Exercise real HTTP failures and retained-source rebuilds without public hosts.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const exec = promisify(execFile);
const helper = fileURLToPath(
  new URL("../packaging/native-runtime/fetch-source.sh", import.meta.url),
);
test("source retrieval verifies every candidate and reuses retained bytes", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "shadowcode-sources-"));
  const requests = [];
  const bytes = Buffer.from("the exact pinned archive bytes\n");
  const digest = (algorithm) =>
    createHash(algorithm).update(bytes).digest("hex");
  const server = createServer((request, response) => {
    requests.push(request.url);
    if (request.url === "/good") response.end(bytes);
    else if (request.url === "/wrong") response.end("unexpected HTTP 200 body");
    else if (request.url === "/redirect") {
      response.writeHead(302, { Location: "/wrong" }).end();
    } else response.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const retrieve = (name, algorithm, retained, ...urls) =>
    exec(
      "bash",
      [
        "-c",
        'source "$1"; shift; fetch_source "$@"',
        "source-fixture",
        helper,
        path.join(directory, name),
        algorithm,
        algorithm === "unsupported" ? "wrong" : digest(algorithm),
        path.join(directory, retained),
        ...urls,
      ],
      { timeout: 15000, maxBuffer: 64000 },
    );
  try {
    await retrieve(
      "fallback",
      "sha512",
      "absent",
      `${base}/wrong`,
      `${base}/missing`,
      `${base}/redirect`,
      `${base}/good`,
    );
    assert.deepEqual(await readFile(path.join(directory, "fallback")), bytes);
    assert.deepEqual(requests, [
      "/wrong",
      "/missing",
      "/redirect",
      "/wrong",
      "/good",
    ]);
    await retrieve("sha256", "sha256", "absent", `${base}/good`);
    assert.deepEqual(await readFile(path.join(directory, "sha256")), bytes);
    await assert.rejects(
      retrieve(
        "failed",
        "sha512",
        "absent",
        `${base}/wrong`,
        `${base}/missing`,
      ),
      (error) => error.code === 1 && /No verified source/.test(error.stderr),
    );
    await assert.rejects(readFile(path.join(directory, "failed")), {
      code: "ENOENT",
    });
    const before = requests.length;
    await writeFile(path.join(directory, "retained"), bytes);
    await retrieve("offline", "sha512", "retained", `${base}/missing`);
    await retrieve("fallback", "sha512", "absent", `${base}/missing`);
    assert.equal(
      requests.length,
      before,
      "verified retained/output bytes need no network",
    );
    assert.deepEqual(await readFile(path.join(directory, "offline")), bytes);
    await writeFile(path.join(directory, "damaged"), "changed artifact");
    await assert.rejects(
      retrieve("damaged-output", "sha512", "damaged", `${base}/good`),
    );
    await assert.rejects(
      retrieve("damaged", "sha512", "retained", `${base}/good`),
    );
    await assert.rejects(
      retrieve("unsupported", "unsupported", "absent", `${base}/good`),
    );
    assert.equal(
      requests.length,
      before,
      "invalid retained inputs must fail closed",
    );
    const names = await readdir(directory);
    assert.ok(!names.some((name) => name.includes(".pending.")));
    assert.ok(!names.includes("damaged-output"));
    assert.ok(!names.includes("unsupported"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

// These checks run before the expensive native packaging phase in existing CI.
test("runtime APK pins and retained source provenance agree on both architectures", async () => {
  const { runtimePins, validateRuntimeSourcePins, runtimeIndexError } = await import("./native-runtime-pins.mjs");
  const recipe = new URL("../packaging/native-runtime/", import.meta.url);
  const pins = await readFile(new URL("apk-packages.txt", recipe), "utf8");
  const sources = JSON.parse(await readFile(new URL("alpine-sources.json", recipe), "utf8"));
  validateRuntimeSourcePins(pins, sources);
  assert.throws(() => validateRuntimeSourcePins(pins.replace("zlib-static=1.4-r0", "zlib-static=1.3.2-r1"), sources), /differs from retained zlib/);
  assert.throws(() => validateRuntimeSourcePins(`${pins}aarch64:zlib-static=1.3.2-r1\n`, sources), /aarch64.*differs from retained zlib/);
  const changed = structuredClone(sources);
  changed.packages.find(p => p.name === "zlib").files[0].url = "https://raw.githubusercontent.com/alpinelinux/aports/master/main/zlib/APKBUILD";
  assert.throws(() => validateRuntimeSourcePins(pins, changed), /immutable aports commit/);
  assert.throws(() => runtimePins("zlib-static>=1.4-r0", "aarch64"), /must be exact/);
  assert.throws(() => runtimePins("zlib-static=1.*-r0", "aarch64"), /must be exact/);
  assert.throws(() => runtimePins("zlib-static=1.4-r0\nzlib-static=1.4-r0", "x86_64"), /Duplicate/);
  assert.throws(() => runtimePins("aarch64:zlib-static=1.4-r0", "aarch64"), /no pinned package/);
  const zlib = sources.packages.find(p => p.name === "zlib");
  assert.equal(runtimeIndexError("zlib-static", { o: "zlib", c: zlib.aportsCommit }, sources), null);
  assert.match(runtimeIndexError("zlib-static", { c: zlib.aportsCommit }, sources), /origin must be zlib/);
  assert.match(runtimeIndexError("zlib-static", { o: "unexpected", c: zlib.aportsCommit }, sources), /origin must be zlib/);
  assert.match(runtimeIndexError("zlib-static", { o: "zlib", c: "0".repeat(40) }, sources), /recipe differs/);
  assert.match(runtimeIndexError("zlib-static", undefined, sources), /exact pin missing/);
  assert.equal(runtimeIndexError("bash", {}, sources), null, "Unlinked build tools remain availability-only");
  assert.equal(zlib.version, "1.4-r0");
  assert.deepEqual(zlib.files.map(f => f.file), ["APKBUILD", "zlib-1.4.tar.gz"], "Alpine 1.4 recipe no longer applies the old CVE patch");
});
