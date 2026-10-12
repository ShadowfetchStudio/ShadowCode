import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installFakeBackend } from "./fakeBackend";
import { installFakePerformance } from "./fakePerformance";

// Find in conversation (Ctrl+F) over a 1,000-message conversation: the
// latest 400 events load with the conversation (the transcript draws its
// latest 150 rows of them) and the rest are five saved history pages.
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  (page as Page & { errors?: string[] }).errors = errors;
  await page.addInitScript(installFakeBackend);
  await page.addInitScript(installFakePerformance, {
    messages: 1000,
    windowEvents: 400,
  });
  await page.goto("/");
  await page.locator('.task-link[data-session-id="s1"]').click();
  await expect(rows(page).last()).toContainText("Saved message 01000.");
});
test.afterEach(async ({ page }) => {
  expect((page as Page & { errors?: string[] }).errors).toEqual([]);
});

const rows = (page: Page) =>
  page.locator(".msg-user .bubble, .msg-agent .markdown");
const message = (page: Page, n: number) =>
  rows(page).filter({
    hasText: `Saved message ${String(n).padStart(5, "0")}.`,
  });
const findBox = (page: Page) =>
  page.getByRole("textbox", { name: "Find in conversation" });
const count = (page: Page) => page.locator(".find-bar [role=status]");
/** The text the current-match highlight covers ("" without one). */
const currentHighlight = (page: Page) =>
  page.evaluate(() => {
    const highlight = CSS.highlights.get("shadow-find-current");
    return highlight ? [...highlight].map(String).join("|") : "";
  });

test("Ctrl+F finds text in rows not drawn yet and in saved pages", async ({
  page,
}) => {
  const composer = page.getByRole("textbox", { name: "Message ShadowCode" });
  await composer.focus();
  await page.keyboard.press("Control+f");
  await expect(findBox(page)).toBeFocused();

  await findBox(page).fill("message 00990");
  await expect(count(page)).toHaveText("1 of 1");
  await expect(message(page, 990)).toBeInViewport();
  await expect.poll(() => currentHighlight(page)).toBe("message 00990");

  // In the loaded conversation but outside the 150 rows drawn.
  await expect(message(page, 700)).toHaveCount(0);
  await findBox(page).fill("MESSAGE 00700");
  await expect(count(page)).toHaveText("1 of 1");
  await expect(message(page, 700)).toBeInViewport();
  await expect.poll(() => currentHighlight(page)).toBe("message 00700");

  // Answers match as they read (no Markdown markers) and every drawn match
  // is highlighted. A new query starts at the latest match where you are
  // reading; stepping wraps into the oldest saved page and back.
  await findBox(page).fill("with emphasis, code");
  await expect(count(page)).toHaveText("500 of 500");
  await expect
    .poll(() =>
      page.evaluate(() => CSS.highlights.get("shadow-find")?.size || 0),
    )
    .toBeGreaterThan(30);
  await findBox(page).press("Enter");
  await expect(count(page)).toHaveText("1 of 500");
  await expect(page.getByText("Browsing saved history.")).toBeVisible();
  await expect(message(page, 2)).toBeInViewport();
  await findBox(page).press("Shift+Enter");
  await expect(count(page)).toHaveText("500 of 500");
  await expect(page.getByText("Browsing saved history.")).toHaveCount(0);
  await expect(message(page, 1000)).toBeInViewport();

  // Only in a saved page: it opens, like Older messages would.
  await findBox(page).fill("message 00042");
  await expect(count(page)).toHaveText("1 of 1");
  await expect(page.getByText("Browsing saved history.")).toBeVisible();
  await expect(message(page, 42)).toBeInViewport();
  await expect.poll(() => currentHighlight(page)).toBe("message 00042");

  // Nothing on this page: the latest match, back in the latest messages.
  await findBox(page).fill("saved message 0099");
  await expect(count(page)).toHaveText("10 of 10");
  await expect(message(page, 999)).toBeInViewport();
  await findBox(page).press("Enter");
  await expect(count(page)).toHaveText("1 of 10");
  await expect(message(page, 990)).toBeInViewport();
  await page.keyboard.press("Shift+F3");
  await expect(count(page)).toHaveText("10 of 10");
  await page.keyboard.press("Shift+F3");
  await expect(count(page)).toHaveText("9 of 10");
  await page.keyboard.press("F3");
  await expect(count(page)).toHaveText("10 of 10");
  await page.getByRole("button", { name: "Previous match" }).click();
  await expect(count(page)).toHaveText("9 of 10");
  await expect(message(page, 998)).toBeInViewport();

  await findBox(page).fill("nothing like this");
  await expect(count(page)).toHaveText("No matches");
  await expect(page.getByRole("button", { name: "Next match" })).toBeDisabled();

  // Escape closes find and puts focus back in the composer.
  await findBox(page).press("Escape");
  await expect(page.locator(".find-bar")).toHaveCount(0);
  await expect(composer).toBeFocused();
  expect(await currentHighlight(page)).toBe("");
});

test("the palette and Ctrl+F open find; another conversation closes it", async ({
  page,
}) => {
  await page.keyboard.press("Control+k");
  await page.getByLabel("Search commands").fill("Find in");
  await page.keyboard.press("Enter");
  await expect(findBox(page)).toBeFocused();
  await findBox(page).fill("message 00999");
  await expect(count(page)).toHaveText("1 of 1");

  // Ctrl+F again (from elsewhere) selects the query to type over.
  await page.getByRole("textbox", { name: "Message ShadowCode" }).focus();
  await page.keyboard.press("Control+f");
  await expect(findBox(page)).toBeFocused();
  expect(
    await findBox(page).evaluate((input: HTMLInputElement) => [
      input.selectionStart,
      input.selectionEnd,
    ]),
  ).toEqual([0, "message 00999".length]);

  await page.keyboard.press("Control+n");
  await expect(page.locator(".find-bar")).toHaveCount(0);
  await page.keyboard.press("Control+f");
  await expect(findBox(page)).toHaveValue("");
});

test("find reads well in both themes and passes axe", async ({ page }) => {
  await page.keyboard.press("Control+f");
  await findBox(page).fill("Saved message 0099");
  await expect(count(page)).toHaveText("10 of 10");
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (t) => (document.documentElement.dataset.theme = t),
      theme,
    );
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .include(".find-bar")
      .analyze();
    expect(results.violations).toEqual([]);
    await page.locator(".stage").screenshot({
      path: `test-results/find-${theme}.png`,
    });
  }
});

test("scrolling to a match is instant when reduced motion is asked for", async ({
  page,
}) => {
  await page.evaluate(() => {
    const scope = window as unknown as { scrolls: string[] };
    scope.scrolls = [];
    const original = Element.prototype.scrollTo;
    Element.prototype.scrollTo = function (this: Element, ...args: unknown[]) {
      const options = args[0] as ScrollToOptions | undefined;
      if (options?.behavior) scope.scrolls.push(options.behavior);
      return (original as (...a: unknown[]) => void).apply(this, args);
    };
  });
  const scrolls = () =>
    page.evaluate(() => (window as unknown as { scrolls: string[] }).scrolls);
  await page.keyboard.press("Control+f");
  await findBox(page).fill("message 00900");
  await expect(message(page, 900)).toBeInViewport();
  expect(await scrolls()).toContain("smooth");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(
    () => ((window as unknown as { scrolls: string[] }).scrolls = []),
  );
  await findBox(page).fill("message 00700");
  await expect(message(page, 700)).toBeInViewport();
  expect(await scrolls()).toContain("auto");
  expect(await scrolls()).not.toContain("smooth");
});

test("without the highlight API the match's row is marked", async ({
  page,
}) => {
  await page.evaluate(() => {
    delete (window as unknown as { Highlight?: unknown }).Highlight;
  });
  await page.keyboard.press("Control+f");
  await findBox(page).fill("message 00800");
  await expect(count(page)).toHaveText("1 of 1");
  const marked = page.locator('[data-find-current="row"]');
  await expect(marked).toHaveCount(1);
  await expect(marked).toContainText("Saved message 00800.");
  await expect(message(page, 800)).toBeInViewport();
});
