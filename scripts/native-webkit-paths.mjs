// Release WebKitGTK ignores WEBKIT_EXEC_PATH. Relocate its compiled helper and
// injected-bundle paths without changing ELF offsets. main.rs selects AppDir/usr
// as the GUI working directory before GTK starts. CLI working directories stay put.
import assert from "node:assert/strict";
import {
  access,
  readFile,
  realpath,
  writeFile,
  mkdir,
  copyFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const digest = (b) => createHash("sha256").update(b).digest("hex");
export async function relocateWebKit(appdir, multiarch) {
  assert.ok(
    ["x86_64-linux-gnu", "aarch64-linux-gnu"].includes(multiarch),
    "Unknown WebKit architecture",
  );
  const root = await realpath(appdir);
  const lib = await realpath(path.join(root, "usr/lib/libwebkit2gtk-4.1.so.0"));
  assert.ok(
    lib.startsWith(root + path.sep),
    "WebKit library must remain inside AppDir",
  );
  const helper = path.join(root, "usr/lib", multiarch, "webkit2gtk-4.1");
  for (const name of ["WebKitWebProcess", "WebKitNetworkProcess"]) {
    const file = await realpath(path.join(helper, name));
    assert.ok(
      file.startsWith(root + path.sep),
      "WebKit helper must remain inside AppDir",
    );
    await access(file, constants.X_OK);
  }
  const original = await readFile(lib),
    bytes = Buffer.from(original);
  const before = Buffer.from(`/usr/lib/${multiarch}/webkit2gtk-4.1`);
  const after = Buffer.from(`././/lib/${multiarch}/webkit2gtk-4.1`);
  assert.equal(
    before.length,
    after.length,
    "Relocation must preserve ELF layout",
  );
  let replaced = 0;
  for (
    let offset = bytes.indexOf(before);
    offset >= 0;
    offset = bytes.indexOf(before, offset + after.length)
  ) {
    assert.ok(
      offset === 0 || bytes[offset - 1] === 0,
      "Unexpected embedded WebKit path",
    );
    assert.ok(
      [0, 47].includes(bytes[offset + before.length]),
      "Unexpected WebKit path suffix",
    );
    after.copy(bytes, offset);
    replaced++;
  }
  assert.ok(
    bytes.includes(Buffer.concat([after, Buffer.from([0])])),
    "Missing known helper lookup path; review this WebKit build",
  );
  assert.ok(!bytes.includes(before), "Unrelocated WebKit paths remain");
  if (replaced) await writeFile(lib, bytes);
  const receipt = {
    library: path.relative(root, lib),
    multiarch,
    replaced,
    beforeSha256: digest(original),
    afterSha256: digest(bytes),
    oldPrefix: before.toString(),
    newPrefix: after.toString(),
    workingDirectory: "AppDir/usr",
    scope:
      "Equal-length relocation of compiled helper and injected-bundle paths; no sandbox changes.",
  };
  const docs = path.join(root, "usr/share/doc/shadowcode");
  await mkdir(docs, { recursive: true });
  await writeFile(
    path.join(docs, "WEBKIT-RELOCATION.json"),
    JSON.stringify(receipt, null, 2) + "\n",
  );
  await copyFile(
    fileURLToPath(import.meta.url),
    path.join(docs, "native-webkit-paths.mjs"),
  );
  return receipt;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  console.log(
    JSON.stringify(
      await relocateWebKit(process.argv[2], process.argv[3]),
      null,
      2,
    ),
  );
}
