import { test, expect } from "@playwright/test";
import { installFakeBackend } from "./fakeBackend";
import { installFakeTools } from "./fakeTools";

// Browser-level keyboard ownership. OS menu arbitration and VoiceOver still
// require qualification in the native app; these tests make no such claim.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "platform", { get: () => "MacIntel" });
  });
  await page.addInitScript(installFakeBackend, { stepMs: 60 });
  await page.addInitScript(installFakeTools, {});
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "What should we work on?" }),
  ).toBeVisible();
});

test("Mac palette describes the usable model and terminal shortcuts", async ({
  page,
}) => {
  await page.keyboard.press("Meta+k");
  const dialog = page.getByRole("dialog", { name: "Command palette" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("option", { name: /Choose a model/ }),
  ).toContainText("⌘+Shift+M");
  await expect(
    dialog.getByRole("option", { name: /Open a terminal/ }),
  ).toContainText("Ctrl+`");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+Backquote");
  await expect(page.locator("[data-terminal]")).toBeVisible();
});

test("terminal cursor follows reduced motion changes without restarting the shell", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page
    .getByRole("button", { name: "Show terminal", exact: true })
    .click();
  const terminal = page.locator("[data-terminal]");
  await expect(terminal).toBeVisible();
  const id = await terminal.getAttribute("data-terminal");
  const cursor = terminal.locator(".xterm-cursor");
  await expect(cursor).toBeVisible();
  await expect(cursor).not.toHaveClass(/xterm-cursor-blink/);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(cursor).toHaveClass(/xterm-cursor-blink/);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(cursor).not.toHaveClass(/xterm-cursor-blink/);
  await expect(terminal).toHaveAttribute("data-terminal", id!);
});

test("the palette terminal command transfers focus after closing its dialog", async ({
  page,
}) => {
  const composer = page.getByRole("textbox", { name: "Message ShadowCode" });
  await composer.fill("Preserved composer draft");
  await page.keyboard.press("Meta+k");
  await page
    .getByRole("combobox", { name: "Search commands" })
    .fill("Open a terminal");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "Command palette" }),
  ).toHaveCount(0);
  await expect(page.locator(".xterm-helper-textarea")).toBeFocused();
  await expect(composer).toHaveValue("Preserved composer draft");
});
