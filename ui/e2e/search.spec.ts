import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installFakeBackend } from "./fakeBackend";

// Task search finds words in prompts and in the agent's answers, and shows
// where it matched, against the deterministic fake engine.
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  (page as Page & { errors?: string[] }).errors = errors;
  await page.addInitScript(installFakeBackend, {
    stepMs: 60,
    completedTask: true,
  });
  await page.goto("/");
});
test.afterEach(async ({ page }) => {
  expect((page as Page & { errors?: string[] }).errors).toEqual([]);
});

test("search shows the answer or prompt that matched", async ({ page }) => {
  const sidebar = page.getByRole("complementary", {
    name: "Projects and tasks",
  });
  const search = sidebar.getByRole("textbox", { name: "Search tasks" });
  await search.fill("inspection finished");
  const row = sidebar.locator(".task-row").filter({ hasText: "Answer ·" });
  await expect(row).toHaveCount(1);
  await expect(row.locator(".search-snippet")).toHaveText(
    "Answer · Project inspection finished.",
  );
  await expect(row.locator("mark")).toHaveText("inspection finished");
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (t) => (document.documentElement.dataset.theme = t),
      theme,
    );
    const results = await new AxeBuilder({ page })
      .include(".sidebar")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  }

  await search.fill("inspect the");
  await expect(sidebar.locator(".search-snippet")).toHaveText(
    "You · Inspect the project",
  );
  // Clearing the search lists conversations without excerpts again.
  await search.fill("");
  await expect(sidebar.locator(".search-snippet")).toHaveCount(0);
  await expect(sidebar.locator(".task-row")).not.toHaveCount(0);
});
