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

test("Quick Open jumps directly to a file in the Files drawer editor", async ({
  page,
}) => {
  await page.keyboard.press("Control+o");
  const search = page.getByRole("searchbox", {
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
