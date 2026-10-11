#!/usr/bin/env node
// Builds a signed, flat-pool APT repository from release .debs that were
// already authenticated with scripts/verify-native-release.sh (or an
// equivalent trusted verification). It does not verify publisher signatures
// itself and must never be fed a candidate download directly.
//
//   node scripts/build-apt-repo.mjs --out DIR --fingerprint FPR \
//     [--previous DIR] [--valid-days N] [--date RFC2822] DEB...
//
// The OpenPGP signing key is read from APT_REPO_SIGNING_KEY (an ASCII-armored
// secret key, provided by a protected CI secret) and imported into a private,
// temporary GNUPGHOME that is deleted afterwards. The imported key must have
// exactly the primary fingerprint given by --fingerprint, so a swapped secret
// cannot silently re-root the repository. No key is ever written to --out
// except the public key (shadowcode-archive-keyring.gpg/.asc).
//
// Layout (suite "stable", component "main", architectures amd64 arm64):
//   pool/main/s/shadow-code/<file>.deb
//   dists/stable/{Release,InRelease,Release.gpg}
//   dists/stable/main/binary-{amd64,arm64}/{Packages,Packages.gz,Release}
// --previous keeps .debs already in an earlier published pool, so older
// versions stay installable; an identical name with different bytes fails.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";

const run = promisify(execFile);

export const SUITE = "stable";
export const COMPONENT = "main";
export const ARCHITECTURES = ["amd64", "arm64"];
export const PACKAGE = "shadow-code";
export const ORIGIN = "ShadowCode";
export const LABEL = "ShadowCode";
export const POOL = `pool/${COMPONENT}/s/${PACKAGE}`;
export const KEYRING_NAME = "shadowcode-archive-keyring";
const MAX_DEB = 32 * 1024 ** 3;

const sha = (algo, data) => createHash(algo).update(data).digest("hex");

function fail(message) {
  throw new Error(`build-apt-repo: ${message}`);
}

/** Reads the control fields APT needs from a .deb with dpkg-deb. */
export async function readControl(deb) {
  const { stdout } = await run("dpkg-deb", ["-f", deb], { maxBuffer: 1 << 20 });
  return stdout.replace(/\n+$/, "");
}

function field(control, name) {
  const m = control.match(new RegExp(`^${name}:[ \\t]*(.*)$`, "mi"));
  return m ? m[1].trim() : undefined;
}

/** Validates one package and returns its index stanza data. */
export async function describeDeb(deb) {
  const info = await stat(deb);
  if (!info.isFile() || info.size === 0 || info.size > MAX_DEB) fail(`${deb}: not a bounded regular file`);
  const control = await readControl(deb);
  const pkg = field(control, "Package");
  const version = field(control, "Version");
  const arch = field(control, "Architecture");
  if (pkg !== PACKAGE) fail(`${deb}: package ${pkg ?? "(none)"} is not ${PACKAGE}`);
  if (!version || !/^[0-9][A-Za-z0-9.+~-]*$/.test(version)) fail(`${deb}: bad version ${version}`);
  if (!ARCHITECTURES.includes(arch)) fail(`${deb}: architecture ${arch} is not one of ${ARCHITECTURES.join(", ")}`);
  if (/^(Filename|Size|MD5sum|SHA1|SHA256|SHA512):/im.test(control)) fail(`${deb}: control carries index fields`);
  const bytes = await readFile(deb);
  const name = `${pkg}_${version.replace(/^[0-9]+:/, "")}_${arch}.deb`;
  return { deb, control, pkg, version, arch, name, size: bytes.length, sha256: sha("sha256", bytes), md5: sha("md5", bytes), bytes };
}

async function listPool(dir) {
  try {
    return (await readdir(dir)).filter((n) => n.endsWith(".deb")).map((n) => path.join(dir, n));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function stanza(d) {
  return [
    d.control,
    `Filename: ${POOL}/${d.name}`,
    `Size: ${d.size}`,
    `MD5sum: ${d.md5}`,
    `SHA256: ${d.sha256}`,
  ].join("\n");
}

async function gpg(home, args, input) {
  const child = run("gpg", ["--homedir", home, "--batch", "--no-tty", "--pinentry-mode", "loopback", ...args], { maxBuffer: 1 << 24 });
  if (input !== undefined) {
    child.child.stdin.end(input);
  }
  return child;
}

/** Imports the armored secret key and checks it is exactly `fingerprint`. */
async function importKey(home, armored, fingerprint) {
  await gpg(home, ["--import"], armored);
  const { stdout } = await gpg(home, ["--with-colons", "--list-secret-keys"]);
  const fprs = [];
  let primary = false;
  for (const line of stdout.split("\n")) {
    const f = line.split(":");
    if (f[0] === "sec") { primary = true; continue; }
    if (f[0] === "ssb") { primary = false; continue; }
    if (f[0] === "fpr" && primary) fprs.push(f[9]);
  }
  if (fprs.length !== 1) fail(`signing key must contain exactly one primary secret key, found ${fprs.length}`);
  if (fprs[0] !== fingerprint) fail(`signing key fingerprint ${fprs[0]} does not match the pinned ${fingerprint}`);
}

export async function buildRepository({ debs, out, fingerprint, armoredKey, previous, validDays, date = new Date() }) {
  if (!/^[0-9A-F]{40}$/.test(fingerprint ?? "")) fail("--fingerprint must be a 40-digit uppercase OpenPGP v4 fingerprint");
  if (!armoredKey || !/-----BEGIN PGP PRIVATE KEY BLOCK-----/.test(armoredKey)) fail("APT_REPO_SIGNING_KEY must hold an ASCII-armored secret key");
  if (!debs.length) fail("no .deb given");

  const entries = new Map();
  const add = (d, origin) => {
    const prior = entries.get(d.name);
    if (prior && prior.sha256 !== d.sha256) fail(`${d.name}: ${origin} differs from an existing package with the same name`);
    entries.set(d.name, d);
  };
  if (previous) for (const deb of await listPool(path.join(previous, POOL))) add(await describeDeb(deb), "previous pool");
  for (const deb of debs) add(await describeDeb(deb), "new package");

  await rm(out, { recursive: true, force: true });
  const pool = path.join(out, POOL);
  await mkdir(pool, { recursive: true });
  for (const d of entries.values()) await writeFile(path.join(pool, d.name), d.bytes);

  const dist = path.join(out, "dists", SUITE);
  const indexFiles = [];
  for (const arch of ARCHITECTURES) {
    const rel = `${COMPONENT}/binary-${arch}`;
    const dir = path.join(dist, rel);
    await mkdir(dir, { recursive: true });
    const items = [...entries.values()].filter((d) => d.arch === arch).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const packages = Buffer.from(items.map(stanza).join("\n\n") + (items.length ? "\n" : ""));
    const archRelease = Buffer.from(`Archive: ${SUITE}\nSuite: ${SUITE}\nComponent: ${COMPONENT}\nOrigin: ${ORIGIN}\nLabel: ${LABEL}\nArchitecture: ${arch}\n`);
    for (const [name, data] of [["Packages", packages], ["Packages.gz", gzipSync(packages, { level: 9 })], ["Release", archRelease]]) {
      await writeFile(path.join(dir, name), data);
      indexFiles.push({ name: `${rel}/${name}`, data });
    }
  }

  const rfc2822 = (d) => d.toUTCString().replace("GMT", "UTC");
  const lines = [
    `Origin: ${ORIGIN}`,
    `Label: ${LABEL}`,
    `Suite: ${SUITE}`,
    `Codename: ${SUITE}`,
    `Date: ${rfc2822(date)}`,
  ];
  if (validDays) lines.push(`Valid-Until: ${rfc2822(new Date(date.getTime() + validDays * 86400000))}`);
  lines.push(
    `Architectures: ${ARCHITECTURES.join(" ")}`,
    `Components: ${COMPONENT}`,
    "Acquire-By-Hash: no",
    `Description: ShadowCode release packages`,
    "MD5Sum:",
    ...indexFiles.map((f) => ` ${sha("md5", f.data)} ${String(f.data.length).padStart(10)} ${f.name}`),
    "SHA256:",
    ...indexFiles.map((f) => ` ${sha("sha256", f.data)} ${String(f.data.length).padStart(10)} ${f.name}`),
  );
  const release = lines.join("\n") + "\n";
  await writeFile(path.join(dist, "Release"), release);

  const home = await mkdtemp(path.join(tmpdir(), "apt-repo-gnupg-"));
  try {
    await importKey(home, armoredKey, fingerprint);
    const signer = ["--local-user", `${fingerprint}!`, "--digest-algo", "SHA512"];
    await gpg(home, [...signer, "--clearsign", "--output", path.join(dist, "InRelease"), path.join(dist, "Release")]);
    await gpg(home, [...signer, "--armor", "--detach-sign", "--output", path.join(dist, "Release.gpg"), path.join(dist, "Release")]);
    await gpg(home, ["--export", "--output", path.join(out, `${KEYRING_NAME}.gpg`), fingerprint]);
    await gpg(home, ["--export", "--armor", "--output", path.join(out, `${KEYRING_NAME}.asc`), fingerprint]);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
  await writeFile(path.join(out, "shadowcode.sources"), sourcesFile());
  return { packages: [...entries.keys()].sort(), release };
}

/** The deb822 source users place in /etc/apt/sources.list.d/. */
export function sourcesFile(uri = "https://shadowfetchstudio.github.io/ShadowCode/apt") {
  return [
    "Types: deb",
    `URIs: ${uri}`,
    `Suites: ${SUITE}`,
    `Components: ${COMPONENT}`,
    `Architectures: ${ARCHITECTURES.join(" ")}`,
    `Signed-By: /etc/apt/keyrings/${KEYRING_NAME}.gpg`,
    "",
  ].join("\n");
}

async function main(argv) {
  const opts = { debs: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") opts.out = argv[++i];
    else if (a === "--fingerprint") opts.fingerprint = argv[++i];
    else if (a === "--previous") opts.previous = argv[++i];
    else if (a === "--valid-days") opts.validDays = Number(argv[++i]);
    else if (a === "--date") opts.date = new Date(argv[++i]);
    else if (a.startsWith("--")) fail(`unknown option ${a}`);
    else opts.debs.push(a);
  }
  if (!opts.out) fail("--out is required");
  if (opts.validDays !== undefined && !(Number.isInteger(opts.validDays) && opts.validDays > 0)) fail("--valid-days must be a positive integer");
  opts.armoredKey = process.env.APT_REPO_SIGNING_KEY;
  const result = await buildRepository(opts);
  process.stdout.write(`APT repository in ${opts.out}:\n${result.packages.map((p) => `  ${p}\n`).join("")}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
