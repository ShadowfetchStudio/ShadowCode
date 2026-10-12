import { test, expect, type Page } from "@playwright/test";
import { installFakeBackend } from "./fakeBackend";

// Settings › Agent in the desktop window (fake engine): edit, see the
// inline checks, survive a refused save, and save only what changed.
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  (page as Page & { errors?: string[] }).errors = errors;
  await page.addInitScript(installFakeBackend, { stepMs: 60 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "What should we work on?" }),
  ).toBeVisible();
});
test.afterEach(async ({ page }) => {
  expect((page as Page & { errors?: string[] }).errors).toEqual([]);
});

type Logged = { method: string; path: string; body: any };
const configSaves = (page: Page) =>
  page.evaluate(() =>
    (
      window as unknown as { __SHADOW_FAKE__: { log: Logged[] } }
    ).__SHADOW_FAKE__.log.filter(
      (r) => r.method === "PUT" && r.path === "/api/config",
    ),
  );

async function openAgent(page: Page) {
  await page.keyboard.press("Control+,");
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog.getByRole("button", { name: "Agent", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "Agent" })).toBeVisible();
  return dialog;
}

test("edits agent settings, checks them inline and saves only what changed", async ({
  page,
}) => {
  const dialog = await openAgent(page);
  const steps = dialog.getByLabel("Steps per task", { exact: true });
  const save = dialog.getByRole("button", { name: "Save", exact: true });
  // The engine's values, with what each does, its range and default.
  await expect(steps).toHaveValue("64");
  await expect(steps).toHaveAccessibleDescription(/1–1,000 · default 64\.$/);
  await expect(
    dialog.getByLabel("Running at once", { exact: true }),
  ).toHaveValue("4");
  await expect(
    dialog.getByLabel("Checkpoints kept per repository", { exact: true }),
  ).toHaveValue("200");
  await expect(save).toBeDisabled();

  // Out of range: said under the field, and Save waits.
  await steps.fill("1001");
  await expect(steps).toHaveAttribute("aria-invalid", "true");
  await expect(steps).toHaveAccessibleDescription(
    /Enter a whole number from 1 to 1,000\.$/,
  );
  await expect(dialog.getByRole("status")).toHaveText(
    "Fix the setting marked above to save.",
  );
  await expect(save).toBeDisabled();
  await steps.fill("120");
  await expect(steps).not.toHaveAttribute("aria-invalid", "true");

  await dialog
    .getByLabel("Shorten history at this share of the context", { exact: true })
    .fill("0.8");
  await dialog
    .getByLabel("Pause and ask when the agent seems stuck", { exact: true })
    .uncheck();
  await dialog.getByLabel("Running at once", { exact: true }).fill("6");
  await dialog
    .getByLabel("Before subscription turns", { exact: true })
    .uncheck();
  await dialog.getByRole("button", { name: "Add a check" }).click();
  // The new row has focus: type straight into it.
  await expect(dialog.getByLabel("Check 1", { exact: true })).toBeFocused();
  await page.keyboard.type("npm test");

  // Keyboard: Reset puts the default back and returns focus to the field.
  const timeout = dialog.getByLabel("Tool time limit", { exact: true });
  await timeout.fill("90");
  await dialog
    .getByRole("button", { name: "Reset Tool time limit to its default" })
    .focus();
  await page.keyboard.press("Enter");
  await expect(timeout).toHaveValue("60");
  await expect(timeout).toBeFocused();

  await page.screenshot({ path: "test-results/settings-agent-edit.png" });

  // The engine refuses the first save: its reason shows on the page.
  await page.evaluate(() => {
    const w = window as unknown as {
      __SHADOW_TEST_TRANSPORT__: {
        request: (p: string, m: string, b: unknown) => Promise<unknown>;
      };
    };
    const bridge = w.__SHADOW_TEST_TRANSPORT__;
    const request = bridge.request.bind(bridge);
    let refused = false;
    bridge.request = async (path, method, body) => {
      if (path === "/api/config" && method === "PUT" && !refused) {
        refused = true;
        throw new Error(
          "/home/dev/.config/shadow-agent/config.yaml needs a fix: model.context_limit must be between 1024 and 4000000 tokens; found 12",
        );
      }
      return request(path, method, body);
    };
  });
  await save.click();
  const refusal = dialog.getByRole("alert");
  await expect(refusal).toHaveText(
    /needs a fix: model\.context_limit must be between 1024 and 4000000 tokens; found 12$/,
  );
  await expect(save).toHaveAccessibleDescription(/model\.context_limit/);
  expect(await configSaves(page)).toEqual([]);

  // Saved on the next try: only the changed keys of the page's groups.
  await save.click();
  await expect(
    page.getByRole("status").filter({ hasText: "Settings saved" }),
  ).toBeVisible();
  await expect(refusal).toHaveCount(0);
  const saves = await configSaves(page);
  expect(saves).toHaveLength(1);
  expect(saves[0].body.values).toEqual({
    agent: { max_steps: 120, compact_ratio: 0.8, stuck_check: false },
    subagents: { max_parallel: 6 },
    checkpoints: { vendor: false },
    verification: { commands: ["npm test"] },
  });
  await expect(save).toBeDisabled();

  // Reopened, the page shows what the engine now has.
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  const again = await openAgent(page);
  await expect(again.getByLabel("Steps per task", { exact: true })).toHaveValue(
    "120",
  );
  await expect(
    again.getByLabel("Running at once", { exact: true }),
  ).toHaveValue("6");
  await expect(again.getByLabel("Nesting depth", { exact: true })).toHaveValue(
    "1",
  );
  await expect(
    again.getByLabel("Pause and ask when the agent seems stuck", {
      exact: true,
    }),
  ).not.toBeChecked();
  await expect(again.getByLabel("Check 1", { exact: true })).toHaveValue(
    "npm test",
  );
  await expect(
    again.getByRole("button", { name: "Reset Steps per task to its default" }),
  ).toBeVisible();
});

test("the command palette opens Settings › Agent", async ({ page }) => {
  await page.keyboard.press("Control+k");
  await page.keyboard.type("limits, retries, subagents");
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog.getByRole("heading", { name: "Agent" })).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Agent", exact: true }),
  ).toHaveAttribute("aria-current", "page");
});
