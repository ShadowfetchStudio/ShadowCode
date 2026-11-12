// Read-only network audit: every exact pin on both supported Alpine builders.
// This never updates locks. APK signature/dependency verification remains apk's
// job in the pinned container; HTTPS index hashes here are audit evidence.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { runtimePins, validateRuntimeSourcePins, runtimeIndexError } from "./native-runtime-pins.mjs";
const recipe = new URL("../packaging/native-runtime/", import.meta.url);
const pins = await readFile(new URL("apk-packages.txt", recipe), "utf8");
const sources = JSON.parse(await readFile(new URL("alpine-sources.json", recipe), "utf8"));
validateRuntimeSourcePins(pins, sources);
const outputIndex = process.argv.indexOf("--output");
assert.ok(outputIndex === -1 || process.argv[outputIndex + 1], "--output requires a JSON path");
const report = { checkedAt: new Date().toISOString(), branch: "v3.21", architectures: {} };
let failures = 0;
for (const arch of ["aarch64", "x86_64"]) {
  const records = new Map(), indexes = [];
  for (const repository of ["main", "community"]) {
    const url = `https://dl-cdn.alpinelinux.org/alpine/v3.21/${repository}/${arch}/APKINDEX.tar.gz`;
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    assert.ok(response.ok, `${url}: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const tar = spawnSync("tar", ["-xzOf", "-", "APKINDEX"], { input: bytes, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 15000 });
    assert.equal(tar.status, 0, tar.stderr || String(tar.error));
    indexes.push({ url, sha256: createHash("sha256").update(bytes).digest("hex") });
    for (const block of tar.stdout.trim().split(/\n\n/)) {
      const fields = Object.fromEntries(block.split("\n").filter(line => line.includes(":")).map(line => [line.slice(0, line.indexOf(":")), line.slice(line.indexOf(":") + 1)]));
      if (fields.P) records.set(`${fields.P}=${fields.V}`, fields);
    }
  }
  const selected = [];
  for (const [name, version] of runtimePins(pins, arch)) {
    const record = records.get(`${name}=${version}`);
    const error = runtimeIndexError(name, record, sources);
    if (error) failures++;
    selected.push({ name, version, origin: record?.o, aportsCommit: record?.c, error });
  }
  report.architectures[arch] = { indexes, pins: selected };
  console.log(`${arch}: ${selected.length} pins, ${selected.filter(pin => pin.error).length} errors`);
  for (const pin of selected.filter(pin => pin.error)) console.error(`${arch}: ${pin.name}=${pin.version}: ${pin.error}`);
}
if (outputIndex !== -1) await writeFile(process.argv[outputIndex + 1], `${JSON.stringify(report, null, 2)}\n`);
assert.equal(failures, 0, "Runtime pins/source provenance require review; no lock was changed");
