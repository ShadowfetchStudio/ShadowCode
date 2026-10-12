import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installFakeBackend } from "./fakeBackend";
import { installFakeTools } from "./fakeTools";
import { expectEditorText } from "./editorHelpers";

// Text size and theme: the zoom keys, Settings › Appearance's live preview,
// the command palette, and the CSS zoom a browser falls back to (the desktop
// zooms its webview instead) keeping the terminal and editor accurate.
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  (page as Page & { errors?: string[] }).errors = errors;
  await page.addInitScript(installFakeBackend, { stepMs: 60, keepUi: true });
  await page.addInitScript(installFakeTools, {});
  // The size the window opened at, before the config was read.
  await page.addInitScript(() =>
    document.addEventListener("DOMContentLoaded", () => {
      (window as any).__zoomAtStart =
        document.documentElement.style.zoom || "1";
    }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "What should we work on?" }),
  ).toBeVisible();
});
test.afterEach(async ({ page }) => {
  expect((page as Page & { errors?: string[] }).errors).toEqual([]);
});

const zoom = (page: Page) =>
  page.evaluate(() => document.documentElement.style.zoom || "1");
const theme = (page: Page) =>
  page.evaluate(() => document.documentElement.dataset.theme);
const savedUi = (page: Page) =>
  page.evaluate(() =>
    (
      (window as any).__SHADOW_FAKE__.log as {
        method: string;
        path: string;
        body: { values?: { ui?: Record<string, unknown> } };
      }[]
    )
      .filter((r) => r.method === "PUT" && r.path === "/api/config")
      .map((r) => r.body.values?.ui),
  );
const both = async (page: Page) => [await theme(page), await zoom(page)];
const status = (page: Page) =>
  page.getByRole("status").filter({ hasText: /^Text size/ });
const heading = (page: Page) =>
  page.getByRole("heading", { name: "What should we work on?" });

test("Ctrl+=, Ctrl+- and Ctrl+0 zoom the window, say the size and keep it", async ({
  page,
}) => {
  const button = page.getByRole("button", { name: "Review changes" });
  const before = (await button.boundingBox())!;
  expect(await zoom(page)).toBe("1");
  await page.keyboard.press("Control+Equal");
  await expect.poll(() => zoom(page)).toBe("1.1");
  await expect(status(page)).toHaveText("Text size 110%");
  // Ctrl++ (Shift, or the keypad) zooms in too; Ctrl+- zooms out.
  await page.keyboard.press("Control+Shift+Equal");
  await expect.poll(() => zoom(page)).toBe("1.25");
  await page.keyboard.press("Control+NumpadAdd");
  await expect.poll(() => zoom(page)).toBe("1.5");
  await page.keyboard.press("Control+Minus");
  await expect.poll(() => zoom(page)).toBe("1.25");
  await expect(status(page)).toHaveText("Text size 125%");
  await page.keyboard.press("Control+0");
  await expect.poll(() => zoom(page)).toBe("1");
  // From the composer as well, up to the largest size.
  await page.getByRole("textbox", { name: "Message ShadowCode" }).focus();
  for (let i = 0; i < 6; i++) await page.keyboard.press("Control+Equal");
  await expect.poll(() => zoom(page)).toBe("1.75");
  await expect(status(page)).toHaveText("Text size 175% · largest");
  // The whole window is larger, not just the text.
  const after = (await button.boundingBox())!;
  for (const ratio of [
    after.height / before.height,
    after.width / before.width,
  ]) {
    // Borders and text snap to whole pixels, so it is close to 1.75.
    expect(ratio).toBeGreaterThan(1.65);
    expect(ratio).toBeLessThan(1.85);
  }
  // Saved once the keys stop, and remembered for the next start.
  await expect
    .poll(() => savedUi(page).then((saved) => saved.at(-1)))
    .toEqual({ zoom: 1.75 });
  expect(await page.evaluate(() => localStorage.getItem("shadow:zoom"))).toBe(
    "1.75",
  );
  await expect(page.locator(".zoom-status")).toBeEmpty();
  // A dialog keeps its keys.
  await page.keyboard.press("Control+,");
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await page.keyboard.press("Control+Minus");
  await page.keyboard.press("Escape");
  expect(await zoom(page)).toBe("1.75");
  // A reload opens at the saved size before the config has been read.
  await page.reload();
  await expect(heading(page)).toBeVisible();
  expect(await page.evaluate(() => (window as any).__zoomAtStart)).toBe("1.75");
  expect(await zoom(page)).toBe("1.75");
});

test("Settings › Appearance shows theme and text size as they are picked, and only Save keeps them", async ({
  page,
}) => {
  const settings = page.getByRole("dialog", { name: "Settings" });
  const open = async () => {
    await page.keyboard.press("Control+,");
    await settings
      .getByRole("button", { name: "Appearance", exact: true })
      .click();
  };
  const option = (group: string, name: string) =>
    settings
      .getByRole("radiogroup", { name: group })
      .getByRole("radio", { name, exact: true });
  await open();
  await expect(option("Theme", "Light")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(option("Text size", "100%")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  const reset = settings.getByRole("button", { name: "Reset to 100%" });
  await expect(reset).toBeDisabled();
  await option("Theme", "Dark").click();
  await expect.poll(() => theme(page)).toBe("dark");
  await option("Text size", "150%").click();
  await expect.poll(() => zoom(page)).toBe("1.5");
  // The dialog still fits the window at that size.
  const box = (await settings.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(1000);
  // Another page puts the saved ones back…
  await settings.getByRole("button", { name: "Accounts", exact: true }).click();
  await expect.poll(() => both(page)).toEqual(["light", "1"]);
  await settings
    .getByRole("button", { name: "Appearance", exact: true })
    .click();
  await expect(option("Theme", "Light")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  // …and so does closing Settings, with Close or with Escape.
  await option("Theme", "Dark").click();
  await option("Text size", "125%").click();
  await settings.getByRole("button", { name: "Close", exact: true }).click();
  await expect(settings).toHaveCount(0);
  await expect.poll(() => both(page)).toEqual(["light", "1"]);
  await open();
  await option("Text size", "90%").click();
  await expect.poll(() => zoom(page)).toBe("0.9");
  await page.keyboard.press("Escape");
  await expect(settings).toHaveCount(0);
  await expect.poll(() => zoom(page)).toBe("1");
  expect(await savedUi(page)).toEqual([]);
  // Save keeps them, with the notification choices.
  await open();
  await option("Theme", "Dark").click();
  await option("Text size", "125%").click();
  await expect(reset).toBeEnabled();
  await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .include(".settings")
    .analyze()
    .then((results) => expect(results.violations).toEqual([]));
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Settings saved")).toBeVisible();
  expect(await savedUi(page)).toEqual([
    expect.objectContaining({ theme: "dark", zoom: 1.25, notify: true }),
  ]);
  await settings.getByRole("button", { name: "Close", exact: true }).click();
  await expect.poll(() => both(page)).toEqual(["dark", "1.25"]);
  expect(
    await page.evaluate(() => [
      localStorage.getItem("shadow:theme"),
      localStorage.getItem("shadow:zoom"),
    ]),
  ).toEqual(["dark", "1.25"]);
  // Reset previews 100% until Save; leaving brings back the saved 125%.
  await open();
  await reset.click();
  await expect.poll(() => zoom(page)).toBe("1");
  await expect(option("Text size", "100%")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.keyboard.press("Escape");
  await expect.poll(() => zoom(page)).toBe("1.25");
  await page.reload();
  await expect(heading(page)).toBeVisible();
  await expect.poll(() => both(page)).toEqual(["dark", "1.25"]);
});

test("the command palette reaches every theme and the text size", async ({
  page,
}) => {
  const run = async (command: string) => {
    await page.keyboard.press("Control+k");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await palette
      .getByRole("combobox", { name: "Search commands" })
      .fill(command);
    await page.keyboard.press("Enter");
    await expect(palette).toHaveCount(0);
  };
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette
    .getByRole("combobox", { name: "Search commands" })
    .fill("Theme");
  const entry = (name: string) =>
    palette.getByRole("option", { name: `Theme: ${name}`, exact: true });
  await expect(entry("same as the system")).toBeVisible();
  await expect(entry("dark")).toBeVisible();
  await expect(entry("light")).toContainText("In use");
  await expect(entry("dark")).not.toContainText("In use");
  await page.keyboard.press("Escape");
  await run("Theme: dark");
  await expect.poll(() => theme(page)).toBe("dark");
  // System follows the computer's setting, both ways.
  await page.emulateMedia({ colorScheme: "light" });
  await run("Theme: same as the system");
  await expect.poll(() => theme(page)).toBe("light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(() => theme(page)).toBe("dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(() => theme(page)).toBe("light");
  await run("Zoom in");
  await expect.poll(() => zoom(page)).toBe("1.1");
  await expect(status(page)).toHaveText("Text size 110%");
  await run("Zoom out");
  await run("Zoom out");
  await expect.poll(() => zoom(page)).toBe("0.9");
  await run("Reset zoom");
  await expect.poll(() => zoom(page)).toBe("1");
  await expect
    .poll(() => savedUi(page).then((saved) => saved.at(-1)))
    .toEqual({ zoom: 1 });
  expect((await savedUi(page)).slice(0, 2)).toEqual([
    { theme: "dark" },
    { theme: "system" },
  ]);
});

test("zoomed with CSS, the terminal and the editor put the pointer on the right text", async ({
  page,
}) => {
  await page.evaluate(() => {
    const fake = (window as any).__SHADOW_FAKE__;
    fake.state.files["README.md"] = "alpha beta gamma\n";
  });
  for (let i = 0; i < 3; i++) await page.keyboard.press("Control+Equal");
  await expect.poll(() => zoom(page)).toBe("1.5");
  const drawer = page.getByRole("complementary", { name: "Drawer" });
  await page.keyboard.press("Control+`");
  const terminal = drawer.getByRole("group", { name: "Terminal 1" });
  await expect(terminal).toContainText("demo$");
  await terminal.click();
  const echoed = "one two three four five";
  await page.keyboard.type(`echo ${echoed}`);
  await page.keyboard.press("Enter");
  const rows = terminal.locator(".xterm-rows > div");
  await expect(
    rows.filter({ hasText: new RegExp(`^${echoed}\\s*$`) }),
  ).toHaveCount(1);
  // The terminal fits the window (its height is a share of it).
  const screen = (await terminal.boundingBox())!;
  expect(screen.y + screen.height).toBeLessThanOrEqual(1000);
  // Double-click "four" on the second row: the selection covers that word,
  // not one further right or lower (where unscaled maths would land).
  const word = await rows
    .filter({ hasText: new RegExp(`^${echoed}\\s*$`) })
    .evaluate((row) => {
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        const at = node.data.indexOf("four");
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + "four".length);
        const r = range.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }
      throw new Error("echoed word not found");
    });
  await page.mouse.dblclick(word.x + word.width / 2, word.y + word.height / 2);
  // xterm draws a first-row box and an empty one for the rows between.
  const selection = () =>
    terminal.evaluate((element) =>
      [...element.querySelectorAll(".xterm-selection div")]
        .map((div) => div.getBoundingClientRect())
        .filter((r) => r.height > 0)
        .map((r) => ({ x: r.x, y: r.y, width: r.width })),
    );
  await expect.poll(selection).toHaveLength(1);
  const [selected] = await selection();
  expect(Math.abs(selected.x - word.x)).toBeLessThan(3);
  expect(Math.abs(selected.y - word.y)).toBeLessThan(3);
  expect(Math.abs(selected.width - word.width)).toBeLessThan(3);
  // The editor: a click before "beta" puts the cursor there.
  await drawer
    .locator(".drawer-tabs")
    .getByRole("tab", { name: "Files" })
    .click();
  await drawer.getByRole("button", { name: "README.md", exact: true }).click();
  const editor = drawer.getByRole("textbox", { name: "Edit README.md" });
  await expectEditorText(editor, "alpha beta gamma\n");
  const b = await editor.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const at = node.data.indexOf("beta");
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + 1);
      const r = range.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }
    throw new Error("beta not found");
  });
  await page.mouse.click(b.x + b.width / 4, b.y + b.height / 2);
  await page.keyboard.type("X");
  await expectEditorText(editor, "alpha Xbeta gamma\n");
});
