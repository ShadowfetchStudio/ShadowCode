import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installFakeBackend } from "./fakeBackend";

// Settings › Accounts › Your own endpoints: connect a server, add its models
// to the picker, test, use and remove them, against the deterministic fake
// engine (an Ollama server on this computer and a keyed cloud API).
type Call = { method: string; path: string; body: any };

async function start(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  (page as Page & { errors?: string[] }).errors = errors;
  await page.addInitScript(installFakeBackend, { stepMs: 60 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "What should we work on?" }),
  ).toBeVisible();
}
test.afterEach(async ({ page }) => {
  expect((page as Page & { errors?: string[] }).errors).toEqual([]);
});

const fakeLog = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __SHADOW_FAKE__: { log: Call[] } })
        .__SHADOW_FAKE__.log,
  );

async function openCard(page: Page) {
  await page.keyboard.press("Control+,");
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("button", { name: "Accounts", exact: true }).click();
  const card = settings.getByRole("article", { name: "Your own endpoints" });
  await card.scrollIntoViewIfNeeded();
  return { settings, card };
}

async function accessible(page: Page) {
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (t) => (document.documentElement.dataset.theme = t),
      theme,
    );
    const results = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  }
}

test("a server on this computer and a keyed cloud API join the picker", async ({
  page,
}) => {
  await start(page);
  const { settings, card } = await openCard(page);
  await expect(card).toContainText("No endpoints added yet.");

  // Ollama on this computer: the address is filled in and no key is needed.
  await card.getByRole("button", { name: "Add an endpoint…" }).click();
  const server = card.getByRole("combobox", { name: "Server" });
  await expect(server).toBeFocused();
  await expect(card.getByRole("textbox", { name: "Address" })).toHaveValue(
    "http://127.0.0.1:11434/v1",
  );
  await card.getByRole("button", { name: "Find models" }).click();
  const models = card.getByRole("group", { name: "Ollama lists 2 models" });
  await models.getByRole("checkbox", { name: "qwen3-coder:30b" }).check();
  await accessible(page);
  await models.getByRole("button", { name: "Add 1 to the picker" }).click();
  await expect(
    page.getByText("Added 1 model to the model picker."),
  ).toBeVisible();
  const added = card.getByRole("list", { name: "Added models" });
  await expect(added).toContainText("qwen3-coder:30b");
  await expect(added).toContainText("Ollama · 127.0.0.1:11434");

  // Test answers in place.
  await added.getByRole("button", { name: "Test qwen3-coder:30b" }).click();
  await expect(added.getByRole("status")).toHaveText("Answered in 0.4 s");

  // A cloud API: the wrong (missing) key is refused with the server's
  // answer, then the typed key lists its models. A bare host gains /v1.
  await card.getByRole("button", { name: "Add an endpoint…" }).click();
  await server.selectOption({ label: "OpenAI or another compatible API" });
  const address = card.getByRole("textbox", { name: "Address" });
  await address.fill("https://api.example.com");
  await card.getByRole("button", { name: "Find models" }).click();
  await expect(card.getByRole("alert")).toHaveText(
    "https://api.example.com/v1 answered 401; check the API key",
  );
  await expect(
    card.getByRole("textbox", { name: "Or add a model by its exact name" }),
  ).toBeVisible();
  await card.getByLabel("API key", { exact: true }).fill("sk-example-good");
  await card.getByRole("button", { name: "Find models" }).click();
  await expect(address).toHaveValue("https://api.example.com/v1");
  await card
    .getByRole("group", { name: "OpenAI-compatible lists 2 models" })
    .getByRole("checkbox", { name: "example-coder" })
    .check();
  await card.getByRole("button", { name: "Add 1 to the picker" }).click();
  await expect(added).toContainText("example-coder");
  await expect(added).toContainText("OpenAI-compatible · api.example.com");
  const addCall = (await fakeLog(page)).find(
    (r) =>
      r.path === "/api/models/endpoints" &&
      r.body.models?.includes("example-coder"),
  );
  // The key name is the engine's choice for this address; the key itself
  // goes out only in this request.
  expect(addCall?.body).toMatchObject({
    provider: "openai_compatible",
    endpoint: "https://api.example.com/v1",
    api_key: "sk-example-good",
    api_key_env: "EXAMPLE_API_KEY",
    models: ["example-coder"],
  });
  await expect(card.getByLabel("API key", { exact: true })).toHaveCount(0);

  // Both rows are in the picker, in their groups.
  await settings.getByRole("button", { name: "Close" }).first().click();
  await page.getByRole("button", { name: /Model for this task/ }).click();
  const search = page.getByRole("combobox", { name: "Search models" });
  await search.fill("example-coder");
  await expect(
    page.getByRole("option", { name: /example-coder/ }),
  ).toContainText("Cloud");
  await search.fill("qwen3-coder");
  await expect(
    page.getByRole("option", { name: /qwen3-coder:30b · This computer/ }),
  ).toContainText("Local");
  await search.press("Enter");
  await expect(
    page.getByRole("button", { name: /Model for this task/ }),
  ).toContainText("qwen3-coder:30b");

  // Removing asks first and keeps the saved key.
  const again = await openCard(page);
  await again.card
    .getByRole("button", { name: "Remove example-coder" })
    .click();
  const confirm = page.getByRole("dialog", { name: "Remove example-coder" });
  await expect(confirm).toContainText("A saved API key stays");
  await confirm.getByRole("button", { name: "Remove" }).click();
  await expect(
    again.card.getByRole("list", { name: "Added models" }),
  ).not.toContainText("example-coder");
});
