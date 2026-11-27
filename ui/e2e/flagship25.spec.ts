import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installFakeBackend } from "./fakeBackend";
import { installFakeTools } from "./fakeTools";
import { expectEditorText } from "./editorHelpers";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(installFakeBackend, { stepMs: 40 });
  await page.addInitScript(installFakeTools, {});
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "What should we work on?" }),
  ).toBeVisible();
});

test("Mission Control opens, filters tasks, returns to chat, and passes axe in both themes", async ({
  page,
}) => {
  const missionBtn = page.getByRole("button", { name: "Mission Control" });
  await missionBtn.click();
  await expect(
    page.getByRole("heading", { level: 2, name: "Mission Control" }),
  ).toBeVisible();

  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    const axe = await new AxeBuilder({ page })
      .include(".mission-control")
      .analyze();
    expect(axe.violations, `axe violations in ${theme} theme`).toEqual([]);
  }

  await page.getByRole("tab", { name: /Completed/i }).click();
  await page.getByRole("button", { name: "Back to chat" }).click();
  await expect(
    page.getByRole("heading", { name: "What should we work on?" }),
  ).toBeVisible();
});

test("phone approval decisions have full touch targets", async ({ page }) => {
  await page.getByRole("button", { name: "Mission Control" }).click();
  await page.evaluate(() => {
    const backend = (window as unknown as { __SHADOW_FAKE__: { requestApproval(r: object): void } }).__SHADOW_FAKE__;
    backend.requestApproval({ tool: "read_file", reason: "Read README", preview: { path: "README.md" } });
  });
  const approvals = page.getByRole("region", { name: "Pending approvals" });
  for (const width of [320, 390, 600]) {
    await page.setViewportSize({ width, height: 844 });
    for (const name of ["Allow", "Deny"]) {
      const button = approvals.getByRole("button", { name, exact: true });
      await button.scrollIntoViewIfNeeded();
      await expect(button).toBeInViewport();
      const box = await button.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
  }
  await approvals.getByRole("button", { name: "Deny", exact: true }).click();
  await expect(approvals).toHaveCount(0);
});

test("Quick Open jumps directly to a file in the Files drawer editor", async ({
  page,
}) => {
  await page.keyboard.press("Control+o");
  const search = page.getByRole("combobox", {
    name: "Search files or symbols",
  });
  await expect(search).toBeVisible();
  await search.fill("README");
  const option = page.getByRole("option").first();
  await expect(option).toContainText("README.md");
  await option.click();

  const drawer = page.getByRole("complementary", { name: "Drawer", exact: true });
  await expect(drawer).toBeVisible();
  await expectEditorText(
    drawer.getByRole("textbox", { name: "Edit README.md" }),
    "# Demo\n",
  );
  await expect(drawer.getByRole("button", { name: "Ask agent" })).toBeVisible();
});

test("previews an unsaved Markdown draft and restores its pinned path after reload", async ({page}) => {
  const open = async () => {
    await page.keyboard.press("Control+o");
    return page.getByRole("dialog", {name:"Quick Open"});
  };
  const dialog = await open();
  await dialog.getByRole("combobox").fill("README:2");
  await dialog.getByRole("option", { name: /README.md/ }).click();
  const editor = page.getByRole("textbox", {name:"Edit README.md"});
  await expectEditorText(editor, "# Demo\n");
  await page.getByRole("button", {name:"Pin file", exact:true}).click();
  await page.getByRole("button", {name:"Markdown preview"}).click();
  const preview = page.getByRole("region", {name:"Markdown preview"});
  await expect(preview.getByRole("heading", {name:"Demo"})).toBeVisible();
  await editor.fill("# Updated draft");
  await expect(preview.getByRole("heading", {name:"Updated draft"})).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Mission Control" })).toBeVisible();
  await open();
  await dialog.getByRole("button", {name:"Pinned", exact:true}).click();
  await expect(dialog.getByRole("option", {name:/README.md/})).toBeVisible();
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    const axe = await new AxeBuilder({page}).include(".quick-open-modal").analyze();
    expect(axe.violations).toEqual([]);
  }
  await dialog.getByRole("button", {name:"Unpin README.md"}).click();
  await expect(dialog.getByRole("option")).toHaveCount(0);
});
