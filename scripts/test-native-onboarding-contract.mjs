// Bounded browser validation of the assertions used by native window tests.
// Uses current UI source and the existing fake backend; no native process,
// accounts, downloads, model turns or production profile. This is not a
// substitute for Linux tauri-driver/WebKitGTK qualification.
// SHADOW_NATIVE_CONTRACT_CACHE may place Vite's disposable cache externally.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertFolderOnboarding, assertWorkspacePermissions, assertWelcomeModelSetup, assertWelcomeControls } from "./fixtures/native-onboarding-smoke.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ui = path.join(root, "ui");
const requireUi = createRequire(path.join(ui, "package.json"));
const { chromium } = requireUi("playwright");
const { transform } = requireUi("esbuild");
const { createServer } = await import(requireUi.resolve("vite"));
const cache = await mkdtemp(path.join(process.env.SHADOW_NATIVE_CONTRACT_CACHE || tmpdir(), "native-onboarding-contract-"));
let server, browser;
const deadline = setTimeout(() => {
  console.error("Native onboarding browser contract exceeded 90 seconds");
  process.exit(1);
}, 90000);
try {
  process.env.VITE_SHADOW_TEST_TRANSPORT = "1";
  server = await createServer({
    root: ui,
    configFile: path.join(ui, "vite.config.ts"),
    configLoader: "runner",
    cacheDir: cache,
    server: { host: "127.0.0.1", port: 0, strictPort: false },
    logLevel: "error",
  });
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  const compiled = await transform(await readFile(path.join(ui, "e2e/fakeBackend.ts"), "utf8"), { loader: "ts", format: "esm", target: "esnext" });
  const { installFakeBackend } = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString("base64")}`);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  // Prevent external traffic even if a future first-run UI adds a request.
  await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.addInitScript(installFakeBackend, { firstRun: true });
  await page.goto(origin);
  await page.locator("#onboarding-folder").waitFor();
  const execute = (script, args = []) => page.evaluate(({ script, args }) => new Function(script).apply(window, args), { script, args });
  await assertFolderOnboarding(execute);
  await page.addScriptTag({ content: await readFile(requireUi.resolve("axe-core/axe.min.js"), "utf8") });
  const accessibility = async label => {
    const serious = await page.evaluate(async () => {
      const report = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } });
      return report.violations.filter(v => ["serious", "critical"].includes(v.impact)).map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }));
    });
    assert.deepEqual(serious, [], `${label}: no serious/critical axe violations`);
  };
  await accessibility("Folder onboarding");
  // Prove the shared assertion still rejects removal of the trust disclosure.
  const disclosure = await page.locator(".wizard p").filter({ hasText: "Opening trusts this folder" }).elementHandle();
  const original = await disclosure.innerText();
  await disclosure.evaluate(e => { e.textContent = "Open any folder."; });
  await assert.rejects(assertFolderOnboarding(execute), /Opening trusts this folder/);
  await disclosure.evaluate((e, text) => { e.textContent = text; }, original);
  await page.getByRole("button", { name: "Open project", exact: true }).click();
  await page.locator(".wizard").waitFor({ state: "detached" });
  await page.getByRole("textbox", { name: "Message ShadowCode" }).waitFor();
  await page.locator(".welcome-model-setup .model-setup").waitFor();
  await assertWelcomeModelSetup(execute);
  await assertWelcomeControls(execute);
  await accessibility("Inline model setup");
  assert.equal(await page.locator(".unified-picker-trigger").count(), 1);
  assert.deepEqual(await page.locator(".welcome-suggestions button").evaluateAll(buttons => buttons.map(b => b.getAttribute("aria-label"))), ["Explain this project", "Fix a bug", "Add tests"]);
  await page.getByRole("radio", { name: /Download a free model/ }).waitFor();
  assert.equal(await page.getByRole("radio", { name: /Download a free model/ }).isChecked(), true);
  // A real extra model dropdown remains forbidden (the key-provider exception
  // must not make the original regression check ineffective).
  await execute("const s=document.createElement('select');s.id='unexpected-model-select';document.body.append(s)");
  await assert.rejects(assertWelcomeControls(execute), /No select-based model controls/);
  await execute("document.querySelector('#unexpected-model-select').remove()");
  await page.getByRole("button", { name: "Explain this project", exact: true }).click();
  assert.match(await page.getByRole("textbox", { name: "Message ShadowCode" }).inputValue(), /Explore this project/);
  await page.locator("details.composer-more > summary").click();
  assert.match(await page.locator(".composer-more-menu").innerText(), /Compare/);
  assert.match(await page.locator(".composer-more-menu").innerText(), /Worktree/);
  await page.locator("details.composer-more > summary").click();
  await page.getByRole("button", { name: "See other free models", exact: true }).click();
  await page.locator(".settings-nav").waitFor();
  await page.locator("#local-gguf").waitFor();
  assert.match(await page.locator(".settings-body").innerText(), /Download a free model/i);
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "Permissions & network", exact: true }).click();
  assert.match(await page.locator(".settings-body").innerText(), /Ask before actions/);
  const log = await page.evaluate(() => window.__SHADOW_FAKE__.log);
  const submitted = log.find(r => r.method === "POST" && r.path === "/api/onboarding");
  assert.equal(submitted?.body.workspace, "/work/demo");
  assert.equal(submitted?.body.permission_mode, "ask");
  assert.equal(submitted?.body.permission_level, "workspace");
  assert.ok(log.some(r => r.method === "PUT" && r.path === "/api/config" && r.body.values?.permissions?.mode === "ask"));
  assert.equal(log.filter(r => r.method === "POST" && /\/downloads\/|\/login|\/jobs|\/tasks/.test(r.path)).length, 0, "Opening and suggestions do not start downloads, login or tasks");
  // The fake backend intentionally has no persisted onboarding in its status
  // response. Exercise native response checks separately with explicit fixtures.
  const status = { workspace: "/work/demo", trusted: true, onboarding: { completed: true, workspace: "/work/demo" }, permissions: { mode: "ask", level: "workspace" } };
  const api = async (_method, url) => url === "/api/workspace/status" ? status : { values: { permissions: status.permissions } };
  await assertWorkspacePermissions(api, "/work/demo");
  status.trusted = false;
  await assert.rejects(assertWorkspacePermissions(api, "/work/demo"), /explicitly trusts/);
  status.trusted = true;
  status.permissions.mode = "allow_edits";
  await assert.rejects(assertWorkspacePermissions(api, "/work/demo"), /requires approvals/);
  status.permissions.mode = "ask";
  status.permissions.level = "elevated";
  await assert.rejects(assertWorkspacePermissions(api, "/work/demo"), /elevated access/);
  assert.deepEqual(errors, [], "Current UI renders without page errors");
  console.log("PASS: current-source onboarding, trust disclosure, direct composer, inline model setup, picker/select controls, suggestions without send, More, local-model Settings, unchanged Ask before actions Settings, axe, ask-first submission; negative checks reject missing trust, unexpected model select, untrusted workspace, allow-edits and elevated access.");
} finally {
  clearTimeout(deadline);
  await browser?.close();
  await server?.close();
  await rm(cache, { recursive: true, force: true });
}
