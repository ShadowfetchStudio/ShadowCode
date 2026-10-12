import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installFakeBackend } from "./fakeBackend";

// Transcript polish against the fake engine: message times from recorded
// events, a long tool output's Show all and Copy, and the window title.
// Times are read in a fixed zone and locale from a fixed clock.
test.use({ locale: "en-GB", timezoneId: "Europe/London" });

const NOW = "2026-10-12T15:00:00+01:00";
const SEARCH_HITS = 600;
const seconds = (iso: string) => Date.parse(iso) / 1000;

/** Three saved exchanges: nine days ago, yesterday and today. */
const HISTORY = [
  ["saved-1", "2026-10-03T09:15:00+01:00", "Plan the release"],
  ["saved-1", "2026-10-03T09:16:00+01:00", "Here is the plan."],
  ["saved-2", "2026-10-11T14:32:00+01:00", "Update the changelog"],
  ["saved-2", "2026-10-11T14:40:00+01:00", "Updated the changelog."],
  ["saved-3", "2026-10-12T14:32:00+01:00", "Check the tests"],
  ["saved-3", "2026-10-12T14:33:00+01:00", "All tests pass."],
].map(([task, at, text], index) => ({ task, ts: seconds(at), text, index }));

/** Saves the history as the engine records it (installed after the fake). */
function seedHistory(rows: typeof HISTORY) {
  const fake = (window as any).__SHADOW_FAKE__;
  const { state } = fake;
  state.sessions[0].title = "Release checklist";
  for (const row of rows) {
    const record = (type: string, payload: Record<string, unknown>) =>
      state.events.push({
        id: ++state.cursor,
        ts: row.ts,
        type,
        payload,
        session_id: "s1",
        task_id: row.task,
      });
    if (row.index % 2 === 0) record("user.message", { text: row.text });
    else {
      record("model.delta", {
        text: row.text,
        message_id: `m${row.index}`,
        complete: true,
      });
      record("agent.completed", { success: true, summary: row.text });
    }
  }
}

test.beforeEach(async ({ page, context }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  (page as Page & { errors?: string[] }).errors = errors;
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.clock.install({ time: new Date(NOW) });
  await page.addInitScript(installFakeBackend, {
    stepMs: 60,
    searchHits: SEARCH_HITS,
  });
  await page.addInitScript(seedHistory, HISTORY);
  await page.goto("/");
  // The window reopens the saved conversation.
  await expect(page.locator(".chat-stream")).toContainText("All tests pass.");
});
test.afterEach(async ({ page }) => {
  expect((page as Page & { errors?: string[] }).errors).toEqual([]);
});

/** Sends a task on the local model (the fake searches, edits and tests). */
async function send(page: Page, text: string) {
  await page.getByRole("button", { name: /Model for this task/ }).click();
  const search = page.getByRole("combobox", { name: "Search models" });
  await search.fill("qwen3:14b");
  await search.press("Enter");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Message ShadowCode" }).fill(text);
  await page.getByRole("button", { name: "Send task" }).click();
}

/** The new task's summary follows the three saved ones. */
const finished = (page: Page) =>
  expect(page.getByRole("region", { name: "Task summary" })).toHaveCount(4, {
    timeout: 15000,
  });

async function axeClean(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .include(".chat-stream")
    .analyze();
  expect(results.violations).toEqual([]);
}

test("messages show when they were sent, quietly; the window names the conversation", async ({
  page,
}) => {
  await expect(page).toHaveTitle("Release checklist — ShadowCode");
  const times = page.locator(".chat-stream time.message-time");
  await expect(times).toHaveText([
    "3 Oct, 09:15",
    "3 Oct, 09:16",
    "Yesterday 14:32",
    "Yesterday 14:40",
    "14:32",
    "14:33",
  ]);
  // A reply a minute later keeps its time until the message is hovered.
  const quiet = times.nth(5);
  await expect(quiet).toHaveClass(/is-quiet/);
  await expect(quiet).toHaveCSS("opacity", "0");
  await expect(times.nth(4)).toHaveCSS("opacity", "1");
  await page.locator(".msg-agent", { hasText: "All tests pass." }).hover();
  await expect(quiet).toHaveCSS("opacity", "1");
  const yesterday = times.nth(2);
  await expect(yesterday).toHaveAttribute(
    "datetime",
    new Date(HISTORY[2].ts * 1000).toISOString(),
  );
  await expect(yesterday).toHaveAttribute(
    "title",
    /^Sunday,? 11 October 2026 at 14:32$/,
  );

  // A new message: the title shows the task running, and the prompt shows
  // the time it was sent.
  await page.evaluate(() => {
    (window as any).__SHADOW_FAKE__.state.held = ["s1"];
  });
  await send(page, "Find every add");
  await expect(page).toHaveTitle("● Release checklist — ShadowCode");
  await expect(
    page.locator(".msg-user", { hasText: "Find every add" }).locator("time"),
  ).toHaveText("15:00");
  await page.evaluate(() => {
    (window as any).__SHADOW_FAKE__.state.held = [];
  });
  await finished(page);
  await expect(page).toHaveTitle("Release checklist — ShadowCode");
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (t) => (document.documentElement.dataset.theme = t),
      theme,
    );
    await axeClean(page);
  }
});

test("a long tool output can be shown in full and copied", async ({ page }) => {
  await send(page, "Find every add");
  await finished(page);
  await page
    .locator("details.activity-step", { hasText: "Reading project" })
    .last()
    .locator("summary")
    .click();
  const lines = 5 * SEARCH_HITS + 6;
  const showAll = page.getByRole("button", {
    name: `Show all (${lines.toLocaleString("en-GB")} lines) of the output of search_text`,
  });
  const output = page
    .locator(".activity-calls li", { hasText: "search_text" })
    .locator("pre");
  await expect(output).toContainText('"matches": [');
  await expect(output).not.toContainText('"scanned": 600');
  await showAll.click();
  await expect(
    page.getByText(
      `Showing the last 2,000 of ${lines.toLocaleString("en-GB")} lines. Copy includes all of it.`,
    ),
  ).toBeVisible();
  await expect(output).toContainText('"scanned": 600');
  await expect(output).not.toContainText("add0 ");

  const copy = page.getByRole("button", {
    name: "Copy the output of search_text",
  });
  await copy.click();
  await expect(
    page.getByRole("button", { name: "Copied the output of search_text" }),
  ).toHaveText("Copied");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied.split("\n")).toHaveLength(lines);
  expect(copied).toContain("export const add0 = (a, b) => a + b;");
  expect(copied).toContain('"scanned": 600');

  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (t) => (document.documentElement.dataset.theme = t),
      theme,
    );
    await axeClean(page);
  }
  await page
    .getByRole("button", { name: "Show less of the output of search_text" })
    .click();
  await expect(page.getByText(/^Showing the last/)).toHaveCount(0);
  await expect(showAll).toBeVisible();
});
