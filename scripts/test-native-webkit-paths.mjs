import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  chmod,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { relocateWebKit } from "./native-webkit-paths.mjs";

async function fixture(arch, run) {
  const root = await mkdtemp(path.join(tmpdir(), "webkit relocation "));
  try {
    const dir = path.join(root, "usr/lib", arch, "webkit2gtk-4.1");
    await mkdir(dir, { recursive: true });
    for (const name of ["WebKitWebProcess", "WebKitNetworkProcess"]) {
      const p = path.join(dir, name);
      await writeFile(p, "helper");
      await chmod(p, 0o755);
    }
    const library = path.join(root, "usr/lib/libwebkit2gtk-4.1.so.0");
    const absolute = `/usr/lib/${arch}/webkit2gtk-4.1`;
    const bytes = Buffer.from(
      `ELF fixture\0${absolute}\0${absolute}/injected-bundle/\0unrelated /usr/lib/ library metadata\0`,
    );
    await writeFile(library, bytes);
    await run({ root, library, absolute, bytes, dir });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
for (const arch of ["x86_64-linux-gnu", "aarch64-linux-gnu"]) {
  test(`${arch}: helper paths relocate, unrelated bytes and ELF length stay intact`, () =>
    fixture(arch, async ({ root, library, bytes, absolute }) => {
      const receipt = await relocateWebKit(root, arch),
        patched = await readFile(library);
      assert.equal(receipt.replaced, 2);
      assert.equal(patched.length, bytes.length);
      assert.deepEqual(
        patched,
        Buffer.from(
          bytes
            .toString()
            .split(absolute)
            .join(absolute.replace("/usr/lib/", "././/lib/")),
        ),
      );
      assert.ok(
        patched.includes(Buffer.from("unrelated /usr/lib/ library metadata")),
      );
      assert.notEqual(receipt.beforeSha256, receipt.afterSha256);
      assert.equal((await relocateWebKit(root, arch)).replaced, 0);
    }));
}
test("refuses an unknown helper layout before modifying the library", () =>
  fixture("x86_64-linux-gnu", async ({ root, library }) => {
    await writeFile(library, "unknown WebKit layout");
    await assert.rejects(
      relocateWebKit(root, "x86_64-linux-gnu"),
      /Missing known/,
    );
    assert.equal(await readFile(library, "utf8"), "unknown WebKit layout");
  }));
test("refuses an incomplete bundle", () =>
  fixture("x86_64-linux-gnu", async ({ root, library, bytes, dir }) => {
    await rm(path.join(dir, "WebKitNetworkProcess"));
    await assert.rejects(relocateWebKit(root, "x86_64-linux-gnu"), /ENOENT/);
    assert.deepEqual(await readFile(library), bytes);
  }));
test("refuses a library symlink outside the bundle", () =>
  fixture("x86_64-linux-gnu", async ({ root, library, dir }) => {
    const outside = path.join(root, "..", path.basename(root) + "-outside");
    await writeFile(outside, "untouched");
    try {
      await rm(library);
      await symlink(outside, library);
      await assert.rejects(
        relocateWebKit(root, "x86_64-linux-gnu"),
        /inside AppDir/,
      );
      assert.equal(await readFile(outside, "utf8"), "untouched");
    } finally {
      await rm(outside);
    }
  }));
