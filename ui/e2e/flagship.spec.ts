import { writeFile } from "node:fs/promises";
import { test, expect, type Locator } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installFakeBackend } from "./fakeBackend";
import { installFakeTools } from "./fakeTools";
import { expectEditorText } from "./editorHelpers";

async function expectPointAccessible(control: Locator) {
  await expect(control).toBeVisible();
  await expect
    .poll(() =>
      control.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2,
        );
        return hit !== null && element.contains(hit);
      }),
    )
    .toBe(true);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(installFakeBackend, { stepMs: 60 });
  await page.addInitScript(installFakeTools, {});
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "What should we work on?" }),
  ).toBeVisible();
});

test("workspace tools open the real panels and split width survives closing and reload", async ({
  page,
}) => {
  const files = page.getByRole("button", { name: "Show files", exact: true });
  await files.click();
  await expect(
    page.getByRole("tab", { name: "Files", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  const handle = page.getByRole("separator", {
    name: "Resize workspace panel",
  });
  const drawer = page.getByRole("complementary", {
    name: "Drawer",
    exact: true,
  });
  await handle.focus();
  const original = Number(await handle.getAttribute("aria-valuenow"));
  await page.keyboard.press("ArrowLeft");
  await expect(handle).toHaveAttribute("aria-valuenow", String(original + 16));
  await expect
    .poll(async () => (await drawer.boundingBox())!.width)
    .toBe(original + 16);
  await page.keyboard.press("End");
  const maximum = Number(await handle.getAttribute("aria-valuemax"));
  await expect(handle).toHaveAttribute("aria-valuenow", String(maximum));
  const stage = await page.locator(".stage").boundingBox();
  expect(stage!.width).toBeGreaterThanOrEqual(380);
  await page.keyboard.press("Home");
  await expect(handle).toHaveAttribute("aria-valuenow", "320");
  // Pointer dragging follows the boundary rather than scrolling the page.
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 150);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 80, box.y + 150);
  await page.mouse.up();
  await expect(handle).toHaveAttribute("aria-valuenow", "400");
  await page.getByRole("button", { name: "Close drawer" }).click();
  await expect(drawer).toHaveCount(0);
  await files.click();
  await expect(handle).toHaveAttribute("aria-valuenow", "400");
  await page.reload();
  await files.click();
  await expect(handle).toHaveAttribute("aria-valuenow", "400");
  await page
    .getByRole("button", { name: "Show terminal", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "Terminal", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("button", { name: "Show terminal", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("workspace stays readable, accessible and within the window in both themes", async ({
  page,
}) => {
  test.setTimeout(90000);
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    for (const width of [1440, 1024, 760, 520]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(
        page.getByRole("button", { name: "Show files", exact: true }),
      ).toBeInViewport();
      await expect(
        page.getByRole("button", { name: "Send task" }),
      ).toBeInViewport();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page
        .getByRole("button", { name: "Show files", exact: true })
        .click();
      const filesDrawer = page.getByRole("complementary", {
        name: "Drawer",
        exact: true,
      });
      await filesDrawer
        .getByRole("button", { name: "README.md", exact: true })
        .first()
        .click();
      await expectEditorText(
        filesDrawer.getByRole("textbox", { name: "Edit README.md" }),
        "# Demo\n",
      );
      const panel = (await page
        .getByRole("complementary", { name: "Drawer", exact: true })
        .boundingBox())!;
      expect(panel.x).toBeGreaterThanOrEqual(0);
      expect(panel.x + panel.width).toBeLessThanOrEqual(width + 1);
      if (width > 760) {
        const result = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        expect(result.violations).toEqual([]);
      }
      await page.screenshot({
        path: `test-results/flagship-${theme}-${width}.png`,
      });
      await page.getByRole("button", { name: "Close drawer" }).click();
    }
  }
});

test("start cards prepare a task without sending it or changing permission mode", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Explain this project", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Message ShadowCode" }),
  ).toHaveValue(/Explore this project/);
  await expect(
    page.getByRole("textbox", { name: "Message ShadowCode" }),
  ).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Permissions: Ask before actions" }),
  ).toBeVisible();
  const calls = await page.evaluate(() => (window as any).__SHADOW_FAKE__.log);
  expect(
    calls.filter(
      (call: any) => call.method === "POST" && call.path === "/api/jobs",
    ),
  ).toEqual([]);
});

test("a compact workspace can reveal navigation without losing its draft", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 800 });
  const composer = page.getByRole("textbox", { name: "Message ShadowCode" });
  await composer.fill("Keep this while I inspect files");
  await page.getByRole("button", { name: "Show files", exact: true }).click();
  await expect(
    page.getByRole("complementary", { name: "Projects and tasks" }),
  ).toBeHidden();
  await page.getByRole("button", { name: "Show sidebar" }).click();
  await expect(
    page.getByRole("complementary", { name: "Projects and tasks" }),
  ).toBeVisible();
  await expect(composer).toHaveValue("Keep this while I inspect files");
});

test("docking keeps a file, conversation and the same terminal available together", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Show terminal", exact: true })
    .click();
  const shell = page.getByRole("group", { name: "Terminal 1" });
  await shell.click();
  await page.keyboard.type("echo docked");
  await page.keyboard.press("Enter");
  await page
    .getByRole("button", { name: "Dock terminal below workspace" })
    .click();
  const dock = page.getByRole("region", {
    name: "Workspace terminal",
    exact: true,
  });
  await expect(dock.getByRole("group", { name: "Terminal 1" })).toContainText(
    "dockeddemo$",
  );
  const drawer = page.getByRole("complementary", {
    name: "Drawer",
    exact: true,
  });
  await drawer.getByRole("button", { name: /README\.md/ }).click();
  await expect(
    drawer.getByRole("textbox", { name: "Edit README.md" }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Message ShadowCode" }),
  ).toBeInViewport();
  await expect(page.getByRole("group", { name: "Terminal 1" })).toHaveCount(1);
  await page.screenshot({
    path: "test-results/flagship-code-and-terminal.png",
  });
  await page.getByRole("button", { name: "Move to side panel" }).click();
  await expect(dock).toHaveCount(0);
  await expect(drawer.getByRole("group", { name: "Terminal 1" })).toContainText(
    "echo docked",
  );
});

test("docked terminal commands preserve dirty Files and restore focus without another shell", async ({
  page,
}) => {
  const terminal = page.getByRole("button", {
    name: "Show terminal",
    exact: true,
  });
  await terminal.click();
  await expect(page.getByRole("group", { name: "Terminal 1" })).toBeVisible();
  await page
    .getByRole("button", { name: "Dock terminal below workspace" })
    .click();
  const dock = page.getByRole("region", {
    name: "Workspace terminal",
    exact: true,
  });
  const input = dock.locator(".xterm-helper-textarea");
  await expect(terminal).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "Show files", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const drawer = page.getByRole("complementary", {
    name: "Drawer",
    exact: true,
  });
  await drawer.getByRole("button", { name: /README\.md/ }).click();
  const editor = drawer.getByRole("textbox", { name: "Edit README.md" });
  const draft = "# Unsaved work must survive terminal commands";
  await editor.fill(draft);
  const shellId = await dock
    .locator("[data-terminal]")
    .getAttribute("data-terminal");
  await page.keyboard.press("Control+`");
  await expect(input).toBeFocused();
  await expect(
    drawer.getByRole("tab", { name: "Files", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expectEditorText(editor, draft);
  // Invoking the same command inside the dock also leaves Files alone.
  await page.keyboard.press("Control+`");
  await expect(input).toBeFocused();
  await editor.focus();
  await terminal.click();
  await expect(input).toBeFocused();
  await expectEditorText(editor, draft);
  await dock.getByRole("button", { name: "Hide workspace terminal" }).click();
  await expect(dock).toHaveCount(0);
  await expect(terminal).toHaveAttribute("aria-pressed", "false");
  await expect(editor).toBeFocused();
  // Hide retains placement; the command reveals the same shell in the dock.
  await page.keyboard.press("Control+`");
  await expect(input).toBeFocused();
  await expect(terminal).toHaveAttribute("aria-pressed", "true");
  await expect(dock.locator("[data-terminal]")).toHaveAttribute(
    "data-terminal",
    shellId!,
  );
  await expect(page.locator("[data-terminal]")).toHaveCount(1);
  await expectEditorText(editor, draft);
  await page.keyboard.type("echo still-the-same-shell");
  await page.keyboard.press("Enter");
  await expect(dock.locator(".xterm-rows")).toContainText(
    "still-the-same-shell",
  );
  expect(
    await page.evaluate(
      () => (window as any).__SHADOW_FAKE__.tools.terminals.length,
    ),
  ).toBe(1);
  expect(
    await page.evaluate(
      () =>
        (window as any).__SHADOW_FAKE__.log.filter(
          (call: any) =>
            call.method === "POST" && call.path === "/api/terminals",
        ).length,
    ),
  ).toBe(1);
  // The unsaved text was never written to the filesystem fixture.
  expect(
    await page.evaluate(
      () => (window as any).__SHADOW_FAKE__.state.files["README.md"],
    ),
  ).not.toContain(draft);
});

test("docked terminal bottom rows and compact controls stay inside unobstructed geometry", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Show terminal", exact: true })
    .click();
  await expect(page.getByRole("group", { name: "Terminal 1" })).toBeVisible();
  await page
    .getByRole("button", { name: "Dock terminal below workspace" })
    .click();
  const dock = page.getByRole("region", {
    name: "Workspace terminal",
    exact: true,
  });
  const screen = dock.locator(".terminal-screen");
  const drawer = page.getByRole("complementary", {
    name: "Drawer",
    exact: true,
  });
  await drawer
    .getByRole("button", { name: "README.md", exact: true })
    .first()
    .click();
  const editor = drawer.getByRole("textbox", { name: "Edit README.md" });
  await expectEditorText(editor, "# Demo\n");
  for (const size of [
    { width: 1440, height: 900 },
    { width: 1024, height: 640 },
    { width: 760, height: 900 },
    { width: 520, height: 640 },
  ]) {
    await page.setViewportSize(size);
    await expect
      .poll(async () => {
        const pane = (await dock.boundingBox())!;
        const terminal = (await screen.boundingBox())!;
        const xterm = await dock.locator(".xterm-screen").boundingBox();
        const row = await dock
          .locator(".xterm-rows > div")
          .last()
          .boundingBox();
        return (
          row !== null &&
          xterm !== null &&
          terminal.height > 20 &&
          xterm.y + xterm.height <= pane.y + pane.height + 1 &&
          terminal.y + terminal.height <= pane.y + pane.height + 1 &&
          row.y + row.height <= pane.y + pane.height + 1 &&
          pane.y + pane.height <= size.height + 1
        );
      })
      .toBe(true);
    await test.info().attach(`terminal-geometry-${size.width}`, {
      contentType: "application/json",
      body: JSON.stringify(
        {
          viewport: size,
          dock: await dock.boundingBox(),
          terminal: await screen.boundingBox(),
          xterm: await dock.locator(".xterm-screen").boundingBox(),
          lastRow: await dock.locator(".xterm-rows > div").last().boundingBox(),
          drawer: await drawer.boundingBox(),
        },
        null,
        2,
      ),
    });
    for (const name of ["Hide workspace terminal", "Move to side panel"])
      await expectPointAccessible(
        dock.getByRole("button", { name, exact: true }),
      );
    await expectPointAccessible(screen);
    if (size.width <= 760) {
      const side = (await drawer.boundingBox())!;
      const bottom = (await dock.boundingBox())!;
      expect(side.y + side.height).toBeLessThanOrEqual(bottom.y + 1);
    }
    if (size.width === 1440 || size.width === 520) {
      await expectEditorText(editor, "# Demo\n");
      await expect(dock.locator(".xterm-rows")).toContainText("demo$");
      await page.screenshot({
        path: `test-results/flagship-terminal-fixed-${size.width}.png`,
      });
    }
  }
  await screen.click();
  // Enough real keyboard input to move the prompt to the last visible row.
  for (let line = 0; line < 12; line++) {
    await page.keyboard.type(`echo bottom-row-${line}`);
    await page.keyboard.press("Enter");
  }
  await expect(dock.locator(".xterm-rows")).toContainText("bottom-row-11");
  const lastRow = dock.locator(".xterm-rows > div").last();
  await expect(lastRow).toContainText("demo$");
  const row = (await lastRow.boundingBox())!;
  expect(row.y + row.height).toBeLessThanOrEqual(640);
  // xterm's viewport layer receives pointer input over its rendered rows.
  // Require that the row's point reaches this terminal, not an overlay pane.
  expect(
    await lastRow.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const hit = document.elementFromPoint(
        bounds.x + bounds.width / 2,
        bounds.y + bounds.height / 2,
      );
      return hit !== null && element.closest("[data-terminal]")!.contains(hit);
    }),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/flagship-terminal-fixed-520.png",
  });
  await dock.getByRole("button", { name: "Move to side panel" }).click();
  await expect(dock).toHaveCount(0);
  await expect(drawer.locator("[data-terminal]")).toHaveCount(1);
  expect(
    await page.evaluate(
      () => (window as any).__SHADOW_FAKE__.tools.terminals.length,
    ),
  ).toBe(1);
});

test("closing a drawer restores its opener without overriding a later focus choice", async ({
  page,
}) => {
  const files = page.getByRole("button", { name: "Show files", exact: true });
  const drawer = page.getByRole("complementary", {
    name: "Drawer",
    exact: true,
  });
  const composer = page.getByRole("textbox", { name: "Message ShadowCode" });
  await files.click();
  await drawer
    .getByRole("button", { name: "README.md", exact: true })
    .first()
    .click();
  const editor = drawer.getByRole("textbox", { name: "Edit README.md" });
  await expectEditorText(editor, "# Demo\n");
  await editor.focus();
  await drawer.getByRole("button", { name: "Close drawer" }).click();
  await expect(drawer).toHaveCount(0);
  await expect(files).toBeFocused();
  await files.click();
  await drawer
    .getByRole("separator", { name: "Resize workspace panel" })
    .focus();
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(files).toBeFocused();
  await files.click();
  await expectEditorText(editor, "# Demo\n");
  await editor.focus();
  // A newer focus choice in the same turn must win over closing cleanup.
  await page.evaluate(() => {
    (
      document.querySelector('[aria-label="Close drawer"]') as HTMLElement
    ).click();
    (
      document.querySelector('[aria-label="Message ShadowCode"]') as HTMLElement
    ).focus();
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(drawer).toHaveCount(0);
  await expect(composer).toBeFocused();
});

test("run a check is available before the first model turn and preserves its draft", async ({
  page,
}) => {
  const composer = page.getByRole("textbox", { name: "Message ShadowCode" });
  await composer.fill("Draft before any model is chosen");
  await page
    .getByRole("button", { name: "Run project check…", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Run a check", exact: true });
  await dialog.getByLabel("Check command").fill("npm test");
  await dialog.getByRole("button", { name: "Run check", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Allow", exact: true }),
  ).toBeVisible();
  await expect(composer).toHaveValue("Draft before any model is chosen");
  await page.getByRole("button", { name: "Allow", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Review latest task", exact: true }),
  ).toBeVisible();
  const posts = await page.evaluate(() =>
    (window as any).__SHADOW_FAKE__.log.filter(
      (r: any) =>
        r.method === "POST" && ["/api/jobs", "/api/jobs/test"].includes(r.path),
    ),
  );
  expect(posts).toHaveLength(1);
  expect(posts[0].path).toBe("/api/jobs/test");
});

test("project-scoped creation cannot override a later conversation selection", async ({
  page,
}) => {
  await page.evaluate(() => {
    (window as any).__SHADOW_FAKE__.state.projects.push("/other/demo");
  });
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "New task in /other/demo", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".project-parent")).toHaveText(["/work", "/other"]);
  await page.evaluate(() => {
    const w = window as any;
    const bridge = w.__SHADOW_TEST_TRANSPORT__;
    const request = bridge.request.bind(bridge);
    bridge.request = async (path: string, method: string, body: any) => {
      if (
        path === "/api/sessions" &&
        method === "POST" &&
        body.workspace === "/other/demo"
      ) {
        await new Promise<void>((resolve) => {
          w.releaseCreation = resolve;
        });
      }
      return request(path, method, body);
    };
  });
  await page
    .getByRole("button", { name: "New task in /other/demo", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => typeof (window as any).releaseCreation))
    .toBe("function");
  await page.locator('[data-session-id="s1"]').click();
  await page.evaluate(() => (window as any).releaseCreation());
  await expect(page.locator('[data-session-id="s1"]')).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__SHADOW_FAKE__.state.activeSession),
    )
    .toBe("s1");
  await expect(page.locator(".workspace-location")).toHaveText("/work/demo");
  const created = await page.evaluate(() =>
    (window as any).__SHADOW_FAKE__.state.sessions.find(
      (s: any) => s.workspace === "/other/demo",
    ),
  );
  expect(created.workspace).toBe("/other/demo");
});

for (const target of ["editor", "composer", "terminal"] as const) {
  test(`delayed dock readiness honors the current ${target} focus intent`, async ({
    page,
  }) => {
    await page
      .getByRole("button", { name: "Show terminal", exact: true })
      .click();
    await expect(page.locator(".xterm-helper-textarea")).toBeFocused();
    await page
      .getByRole("button", { name: "Dock terminal below workspace" })
      .click();
    const dock = page.getByRole("region", {
      name: "Workspace terminal",
      exact: true,
    });
    await expect(dock.locator(".xterm-helper-textarea")).toBeFocused();
    const drawer = page.getByRole("complementary", {
      name: "Drawer",
      exact: true,
    });
    await drawer
      .getByRole("button", { name: "README.md", exact: true })
      .first()
      .click();
    const editor = drawer.getByRole("textbox", { name: "Edit README.md" });
    await editor.fill("# Dirty editor before reveal");
    await dock.getByRole("button", { name: "Hide workspace terminal" }).click();
    await page.evaluate(() => {
      const w = window as any;
      const bridge = w.__SHADOW_TEST_TRANSPORT__;
      const request = bridge.request.bind(bridge);
      bridge.request = async (path: string, method: string, body: any) => {
        if (path === "/api/terminals" && method === "GET")
          await new Promise<void>((resolve) => {
            w.releaseTerminalList = resolve;
          });
        return request(path, method, body);
      };
    });
    await page
      .getByRole("button", { name: "Show terminal", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(() => typeof (window as any).releaseTerminalList),
      )
      .toBe("function");
    const chosen =
      target === "editor"
        ? editor
        : page.getByRole("textbox", { name: "Message ShadowCode" });
    if (target !== "terminal")
      await chosen.fill("Newer focus choice stays here");
    await page.evaluate(() => (window as any).releaseTerminalList());
    await expect(dock.locator(".xterm-rows")).toContainText("demo$");
    if (target === "terminal") {
      await expect(dock.locator(".xterm-helper-textarea")).toBeFocused();
      await expectEditorText(editor, "# Dirty editor before reveal");
      expect(
        await page.evaluate(
          () => (window as any).__SHADOW_FAKE__.tools.terminals.length,
        ),
      ).toBe(1);
      return;
    }
    await expect(chosen).toBeFocused();
    await page.keyboard.type(" and more typing");
    if (target === "editor")
      await expectEditorText(
        editor,
        "Newer focus choice stays here and more typing",
      );
    else {
      await expect(chosen).toHaveValue(
        "Newer focus choice stays here and more typing",
      );
      await expectEditorText(editor, "# Dirty editor before reveal");
    }
    expect(
      await page.evaluate(
        () =>
          (window as any).__SHADOW_FAKE__.log.filter((call: any) =>
            call.path.endsWith("/input"),
          ).length,
      ),
    ).toBe(0);
    expect(
      await page.evaluate(
        () => (window as any).__SHADOW_FAKE__.tools.terminals.length,
      ),
    ).toBe(1);
    // A fresh explicit request still owns focus once readiness has settled.
    await page.keyboard.press("Control+Backquote");
    await expect(dock.locator(".xterm-helper-textarea")).toBeFocused();
  });
}

test("a visible dock workspace remount does not claim composer focus", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Show terminal", exact: true })
    .click();
  await expect(page.locator(".xterm-helper-textarea")).toBeFocused();
  await page
    .getByRole("button", { name: "Dock terminal below workspace" })
    .click();
  await expect(
    page.locator(".terminal-dock .xterm-helper-textarea"),
  ).toBeFocused();
  await page.evaluate(() => {
    (window as any).__SHADOW_FAKE__.state.projects.push("/other/demo");
  });
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "New task in /other/demo", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    const w = window as any;
    const bridge = w.__SHADOW_TEST_TRANSPORT__;
    const request = bridge.request.bind(bridge);
    bridge.request = async (path: string, method: string, body: any) => {
      if (path === "/api/terminals" && method === "GET")
        await new Promise<void>((resolve) => {
          w.releaseTerminalList = resolve;
        });
      return request(path, method, body);
    };
  });
  await page
    .getByRole("button", { name: "New task in /other/demo", exact: true })
    .click();
  await expect(page.locator(".workspace-location")).toHaveText("/other/demo");
  await expect
    .poll(() => page.evaluate(() => typeof (window as any).releaseTerminalList))
    .toBe("function");
  const composer = page.getByRole("textbox", { name: "Message ShadowCode" });
  await composer.fill("New workspace draft");
  await page.evaluate(() => (window as any).releaseTerminalList());
  await expect(page.locator(".terminal-dock .xterm-rows")).toContainText(
    "demo$",
  );
  await expect(composer).toBeFocused();
  await page.keyboard.type(" remains mine");
  await expect(composer).toHaveValue("New workspace draft remains mine");
  expect(
    await page.evaluate(
      () =>
        (window as any).__SHADOW_FAKE__.log.filter((call: any) =>
          call.path.endsWith("/input"),
        ).length,
    ),
  ).toBe(0);
});

test("CSS zoom uses effective split breakpoints and keeps actual dock geometry reachable", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page
    .getByRole("button", { name: "Show terminal", exact: true })
    .click();
  await expect(page.locator(".xterm-helper-textarea")).toBeFocused();
  await page
    .getByRole("button", { name: "Dock terminal below workspace" })
    .click();
  const dock = page.getByRole("region", {
    name: "Workspace terminal",
    exact: true,
  });
  const files = page.getByRole("button", { name: "Show files", exact: true });
  const drawer = page.getByRole("complementary", {
    name: "Drawer",
    exact: true,
  });
  await drawer
    .getByRole("button", { name: "README.md", exact: true })
    .first()
    .click();
  const editor = drawer.getByRole("textbox", { name: "Edit README.md" });
  await expectEditorText(editor, "# Demo\n");
  const evidence: unknown[] = [];
  for (const width of [800, 1160, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const zoom of [1, 1.25, 1.75]) {
      await page.keyboard.press("Control+0");
      for (
        let step = 0;
        step < (zoom === 1 ? 0 : zoom === 1.25 ? 2 : 4);
        step++
      )
        await page.keyboard.press("Control+Equal");
      await expect
        .poll(() =>
          page.evaluate(() => Number(document.documentElement.style.zoom || 1)),
        )
        .toBe(zoom);
      const effective = width / zoom;
      await expect
        .poll(() =>
          page
            .locator(".app")
            .evaluate((el) => el.classList.contains("workspace-overlay")),
        )
        .toBe(effective <= 760);
      await expect
        .poll(() =>
          page
            .locator(".app")
            .evaluate((el) => el.classList.contains("workspace-compact")),
        )
        .toBe(effective <= 1150);
      for (const sidebar of [true, false]) {
        // Toggle navigation through its real command, including while overlaid.
        const shown = await page
          .locator(".app")
          .evaluate((el) => el.classList.contains("with-sidebar"));
        if (shown !== sidebar) await page.keyboard.press("Control+b");
        if ((await drawer.count()) === 0) await files.click();
        await expectEditorText(editor, "# Demo\n");
        await expect
          .poll(() => page.locator(".stage").evaluate((el) => el.clientWidth))
          .toBeGreaterThanOrEqual(380);
        if (effective > 760) {
          await expect(
            page.getByRole("separator", { name: "Resize workspace panel" }),
          ).toBeVisible();
          expect(
            await drawer.evaluate((el) => el.clientWidth),
          ).toBeGreaterThanOrEqual(319);
        } else {
          await expect(
            page.getByRole("separator", { name: "Resize workspace panel" }),
          ).toBeHidden();
          const side = (await drawer.boundingBox())!;
          expect(side.y + side.height).toBeLessThanOrEqual(
            (await dock.boundingBox())!.y + 1,
          );
        }
        // CodeMirror content can extend below the scrollport; hit the actual
        // visible text line, not the center of its offscreen content height.
        await expectPointAccessible(editor.locator(".cm-line").first());
        await expectPointAccessible(
          drawer.getByRole("button", { name: "Close drawer" }),
        );
        await expectPointAccessible(
          dock.getByRole("button", { name: "Hide workspace terminal" }),
        );
        await expect
          .poll(async () => {
            const pane = (await dock.boundingBox())!;
            const screen = await dock.locator(".xterm-screen").boundingBox();
            const row = await dock
              .locator(".xterm-rows > div")
              .last()
              .boundingBox();
            return (
              !!screen &&
              !!row &&
              screen.height > 0 &&
              screen.y >= pane.y &&
              screen.x >= pane.x - 1 &&
              screen.x + screen.width <= pane.x + pane.width + 1 &&
              screen.y + screen.height <= pane.y + pane.height + 1 &&
              row.y + row.height <= pane.y + pane.height + 1 &&
              pane.y + pane.height <= 1001
            );
          })
          .toBe(true);
        await expectPointAccessible(dock.locator(".terminal-screen"));
        if (sidebar && zoom === 1.75)
          await page.screenshot({
            path: `test-results/flagship-zoom-${width}-175.png`,
          });
        evidence.push({
          width,
          zoom,
          sidebar,
          stageLayoutWidth: await page
            .locator(".stage")
            .evaluate((el) => el.clientWidth),
          overlay: effective <= 760,
          stage: await page.locator(".stage").boundingBox(),
          drawer: await drawer.boundingBox(),
          dock: await dock.boundingBox(),
          xterm: await dock.locator(".xterm-screen").boundingBox(),
        });
        await drawer.getByRole("button", { name: "Close drawer" }).click();
        // The composer is reachable once its compact overlay is dismissed.
        if (effective <= 760 && sidebar) await page.keyboard.press("Control+b");
        await expectPointAccessible(
          page.getByRole("textbox", { name: "Message ShadowCode" }),
        );
        await files.click();
      }
    }
  }
  await writeFile(
    test.info().outputPath("css-zoom-geometry.json"),
    JSON.stringify(evidence, null, 2),
  );
  await test.info().attach("css-zoom-geometry", {
    contentType: "application/json",
    body: JSON.stringify(evidence, null, 2),
  });
});
