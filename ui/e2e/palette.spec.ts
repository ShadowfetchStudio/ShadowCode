import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installFakeBackend } from "./fakeBackend";

// The command palette (Ctrl+K): fuzzy search over commands, conversations
// and projects, the commands run last first, and the combobox keyboard
// model, against the production build and the fake engine.
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  (page as Page & { errors?: string[] }).errors = errors;
  await page.addInitScript(installFakeBackend, {
    stepMs: 60,
    conversations: [
      "Fix the login redirect",
      "Add dark mode to settings",
      "Speed up the test suite",
    ],
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "What should we work on?" }),
  ).toBeVisible();
});
test.afterEach(async ({ page }) => {
  expect((page as Page & { errors?: string[] }).errors).toEqual([]);
});

const palette = (page: Page) =>
  page.getByRole("dialog", { name: "Command palette" });
const search = (page: Page) =>
  palette(page).getByRole("combobox", { name: "Search commands" });
const options = (page: Page) => palette(page).getByRole("option");
const active = (page: Page) =>
  palette(page).locator('[role="option"][aria-selected="true"]');
const group = (page: Page, name: string) =>
  palette(page).getByRole("group", { name });
const panel = (page: Page, name: string) =>
  page
    .getByRole("complementary", { name: "Drawer" })
    .getByRole("group", { name: "Panels" })
    .getByRole("button", { name, exact: true });

async function openPalette(page: Page) {
  await page.keyboard.press("Control+k");
  await expect(search(page)).toBeFocused();
}

/** The field points at the active option, which is the only selected one. */
async function expectActive(page: Page, name: string) {
  await expect(active(page)).toHaveCount(1);
  await expect(active(page)).toHaveAccessibleName(name);
  const id = await active(page).getAttribute("id");
  await expect(search(page)).toHaveAttribute("aria-activedescendant", id!);
  await expect(active(page)).toBeInViewport();
}

test("finds commands by letters in order, emphasises the match and runs the best one", async ({
  page,
}) => {
  await openPalette(page);
  const listbox = palette(page).getByRole("listbox");
  await expect(search(page)).toHaveAttribute("aria-expanded", "true");
  await expect(search(page)).toHaveAttribute(
    "aria-controls",
    (await listbox.getAttribute("id"))!,
  );

  await page.keyboard.type("cmp");
  await expect(options(page).first()).toHaveAccessibleName(
    "Compare models on this task",
  );
  await search(page).fill("rev ch");
  await expect(group(page, "Commands")).toBeVisible();
  await expectActive(page, "Review changes");
  await expect(active(page).locator(".palette-match")).toHaveText([
    "Rev",
    "ch",
  ]);

  // Both themes, with emphasised letters and a conversation listed.
  await search(page).fill("set");
  await expect(group(page, "Conversations")).toBeVisible();
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (t) => (document.documentElement.dataset.theme = t),
      theme,
    );
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .include('[role="dialog"]')
      .analyze();
    expect(results.violations).toEqual([]);
  }

  await search(page).fill("zzqx");
  await expect(palette(page).getByRole("listbox")).toHaveCount(0);
  await expect(search(page)).toHaveAttribute("aria-expanded", "false");
  await expect(palette(page).getByRole("status")).toHaveText(
    "Nothing matches “zzqx”.",
  );

  await search(page).fill("rev ch");
  await page.keyboard.press("Enter");
  await expect(palette(page)).toHaveCount(0);
  await expect(panel(page, "Changes")).toHaveAttribute("aria-pressed", "true");
});

test("opens a conversation by name, as choosing it in the sidebar does", async ({
  page,
}) => {
  await openPalette(page);
  // Nothing typed: commands only.
  await expect(group(page, "Conversations")).toHaveCount(0);
  await page.keyboard.type("login red");
  const found = group(page, "Conversations").getByRole("option");
  await expect(found).toHaveCount(1);
  await expect(found).toHaveAccessibleName("Fix the login redirect");
  // The project it belongs to describes it.
  await expect(found).toHaveAccessibleDescription("demo");
  await expectActive(page, "Fix the login redirect");
  await page.keyboard.press("Enter");

  await expect(palette(page)).toHaveCount(0);
  await expect(
    page.getByRole("heading", { level: 1, name: "Fix the login redirect" }),
  ).toBeVisible();
  await expect(
    page.locator('.task-link[data-session-id="s2"]'),
  ).toHaveAttribute("aria-current", "page");

  // Projects are listed too.
  await openPalette(page);
  await page.keyboard.type("demo");
  await expect(
    group(page, "Projects").getByRole("option"),
  ).toHaveAccessibleName("demo");
});

test("the commands run last come first when nothing is typed, after a reload too", async ({
  page,
}) => {
  await openPalette(page);
  await expect(group(page, "Recent")).toHaveCount(0);
  await page.keyboard.type("keyboard short");
  await page.keyboard.press("Enter");
  const help = page.getByRole("dialog", { name: "Help & Shortcuts" });
  await expect(help).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(help).toHaveCount(0);

  await openPalette(page);
  await page.keyboard.type("brow fi");
  await page.keyboard.press("Enter");
  await expect(panel(page, "Files")).toHaveAttribute("aria-pressed", "true");

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "What should we work on?" }),
  ).toBeVisible();
  await openPalette(page);
  const recent = group(page, "Recent").getByRole("option");
  await expect(recent).toHaveCount(2);
  await expect(recent.nth(0)).toHaveAccessibleName("Browse files");
  await expect(recent.nth(1)).toHaveAccessibleName("Keyboard shortcuts");
  // The newest is ready to run again with Enter.
  await expectActive(page, "Browse files");
  // Listed once: the full list goes on without them.
  await expect(
    palette(page).getByRole("option", { name: "Browse files", exact: true }),
  ).toHaveCount(1);
});

test("arrows, Page Up/Down and Home/End move the active option and keep it in view", async ({
  page,
}) => {
  const composer = page.getByRole("textbox", { name: "Message ShadowCode" });
  await composer.focus();
  await openPalette(page);
  const names = await options(page).evaluateAll((all) =>
    all.map((option) => option.getAttribute("aria-label")!),
  );
  expect(names[0]).toBe("New task");
  await expectActive(page, names[0]);
  await page.keyboard.press("ArrowUp");
  await expectActive(page, names[0]);
  await page.keyboard.press("ArrowDown");
  await expectActive(page, names[1]);
  await page.keyboard.press("End");
  await expectActive(page, names.at(-1)!);
  await page.keyboard.press("ArrowDown");
  await expectActive(page, names.at(-1)!);
  await page.keyboard.press("Home");
  await expectActive(page, names[0]);

  // A page is the options that fit, less one.
  await page.keyboard.press("PageDown");
  const paged = names.indexOf((await active(page).getAttribute("aria-label"))!);
  expect(paged).toBeGreaterThan(3);
  await expectActive(page, names[paged]);
  await page.keyboard.press("PageDown");
  await expectActive(page, names[Math.min(2 * paged, names.length - 1)]);
  await page.keyboard.press("PageUp");
  await expectActive(page, names[paged]);
  await page.keyboard.press("PageUp");
  await expectActive(page, names[0]);

  // The pointer moves the active option too, leaving focus in the field.
  const terminal = palette(page).getByRole("option", {
    name: "Open a terminal",
  });
  await terminal.hover();
  await expectActive(page, "Open a terminal");
  await expect(search(page)).toBeFocused();

  // Escape closes and gives focus back.
  await page.keyboard.press("Escape");
  await expect(palette(page)).toHaveCount(0);
  await expect(composer).toBeFocused();

  // A click runs an option.
  await openPalette(page);
  await palette(page).getByRole("option", { name: "Browse files" }).click();
  await expect(palette(page)).toHaveCount(0);
  await expect(panel(page, "Files")).toHaveAttribute("aria-pressed", "true");
});
