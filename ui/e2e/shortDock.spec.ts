import { writeFile } from "node:fs/promises";
import { test, expect, type Locator, type Page } from "@playwright/test";
import { installFakeBackend } from "./fakeBackend";
import { installFakeTools } from "./fakeTools";
import { expectEditorText } from "./editorHelpers";
import { installFakePerformance } from "./fakePerformance";

type Layout = {
  name: string;
  width: number;
  height: number;
  zoom: number;
  fallback?: boolean;
};

async function withoutSizeQueries(page: Page) {
  // Exercise the shipped compatibility branch in a modern browser. This is
  // feature-branch coverage, not a claim to run macOS 12's native WebView.
  await page.route("**/*.css", async (route) => {
    const response = await route.fetch();
    const css = (await response.text())
      .replace(
        /container:\s*docked-workspace\s*\/\s*size/g,
        "container-type:normal",
      )
      .replace(
        /@container docked-workspace/g,
        "@container unavailable-size-query",
      )
      .replace(/@supports not\s*\(container-type:\s*size\)/g, "@media all");
    await route.fulfill({ response, body: css });
  });
}

async function setLayout(page: Page, mode: Layout) {
  await page.setViewportSize({ width: mode.width, height: mode.height });
  await page.getByRole("button", { name: "Show files", exact: true }).focus();
  if (mode.zoom > 1)
    for (let i = 0; i < 4; i++) await page.keyboard.press("Control+Equal");
  await expect
    .poll(() =>
      page.evaluate(() => Number(document.documentElement.style.zoom || 1)),
    )
    .toBe(mode.zoom);
  await expect(page.locator(".app")).toHaveClass(/workspace-overlay/);
  if (mode.fallback)
    await expect(page.locator(".app")).toHaveCSS("container-type", "normal");
}

/** Reach an item with ordinary wheel input, including nested menu scrollports.
 * No scrollTop assignment, force click, or scrollIntoView is used here. */
async function wheelTo(control: Locator, scrollport: Locator) {
  const page = control.page();
  await expect(scrollport).toBeVisible();
  for (let attempt = 0; attempt < 20; attempt++) {
    const reachable = await control.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(
        r.x + r.width / 2,
        r.y + r.height / 2,
      );
      return hit !== null && el.contains(hit);
    });
    if (reachable) return;
    const action = await control.evaluate((el) => {
      const target = el.getBoundingClientRect();
      const scrollable = (node: Element) =>
        /auto|scroll/.test(getComputedStyle(node).overflowY) &&
        node.scrollHeight > node.clientHeight;
      for (let node = el.parentElement; node; node = node.parentElement) {
        if (!scrollable(node)) continue;
        const rect = node.getBoundingClientRect();
        let top = Math.max(0, rect.top),
          bottom = Math.min(innerHeight, rect.bottom);
        let left = Math.max(0, rect.left),
          right = Math.min(innerWidth, rect.right);
        for (
          let parent = node.parentElement;
          parent;
          parent = parent.parentElement
        ) {
          if (getComputedStyle(parent).overflowY === "visible") continue;
          const clip = parent.getBoundingClientRect();
          top = Math.max(top, clip.top);
          bottom = Math.min(bottom, clip.bottom);
          left = Math.max(left, clip.left);
          right = Math.min(right, clip.right);
        }
        if (bottom - top < 6 || right - left < 6) continue;
        const delta = target.y + target.height / 2 - (top + bottom) / 2;
        if (
          (delta < 0 && node.scrollTop <= 0) ||
          (delta > 0 &&
            node.scrollTop + node.clientHeight >= node.scrollHeight - 1)
        )
          continue;
        // Aim at this scrollport, not another nested scrollport (for example
        // the transcript while trying to reveal its sibling Latest button).
        for (const y of [top + 3, bottom - 3, (top + bottom) / 2]) {
          for (const x of [(left + right) / 2, right - 2, left + 2]) {
            let hit = document.elementFromPoint(x, y);
            if (!hit || !node.contains(hit)) continue;
            while (hit && hit !== node && !scrollable(hit))
              hit = hit.parentElement;
            if (hit === node)
              return {
                x,
                y,
                delta: Math.sign(delta) * Math.min(60, Math.abs(delta)),
              };
          }
        }
      }
      return null;
    });
    if (!action) break;
    await page.mouse.move(action.x, action.y);
    await page.mouse.wheel(0, action.delta);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
  }
  await expectHit(control);
}

async function expectHit(control: Locator) {
  await expect(control).toBeVisible();
  await expect
    .poll(() =>
      control.evaluate((element) => {
        const r = element.getBoundingClientRect();
        const hit = document.elementFromPoint(
          r.x + r.width / 2,
          r.y + r.height / 2,
        );
        return {
          inside:
            r.width > 0 &&
            r.height > 0 &&
            r.left >= 0 &&
            r.top >= 0 &&
            r.right <= innerWidth + 1 &&
            r.bottom <= innerHeight + 1,
          hit: hit !== null && element.contains(hit),
        };
      }),
    )
    .toEqual({ inside: true, hit: true });
}

const layouts: Layout[] = [
  { name: "native zoom equivalent", width: 654, height: 389, zoom: 1 },
  { name: "CSS zoom requested window", width: 1160, height: 720, zoom: 1.75 },
  {
    name: "CSS zoom measured client area",
    width: 1144,
    height: 681,
    zoom: 1.75,
  },
  {
    name: "no size-query fallback",
    width: 654,
    height: 389,
    zoom: 1,
    fallback: true,
  },
];
for (const mode of layouts) {
  test(`short dock keeps controls reachable and state intact: ${mode.name}`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript(installFakeBackend, {
      stepMs: 60,
      network: "offline",
    });
    await page.addInitScript(installFakeTools, {});
    if (mode.fallback) await withoutSizeQueries(page);
    await page.goto("/");
    const composer = page.getByRole("textbox", { name: "Message ShadowCode" });
    const composerDraft = "Unsent qualification draft";
    await composer.fill(composerDraft);
    await page
      .getByRole("button", { name: "Hide sidebar", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Show terminal", exact: true })
      .click();
    await expect(page.locator(".xterm-helper-textarea")).toBeFocused();
    await page.keyboard.type("echo short-dock-state");
    await page.keyboard.press("Enter");
    await page
      .getByRole("button", { name: "Dock terminal below workspace" })
      .click();
    const dock = page.getByRole("region", {
      name: "Workspace terminal",
      exact: true,
    });
    const terminalId = await dock
      .locator("[data-terminal]")
      .getAttribute("data-terminal");
    const drawer = page.getByRole("complementary", {
      name: "Drawer",
      exact: true,
    });
    await drawer
      .getByRole("button", { name: "README.md", exact: true })
      .first()
      .click();
    const editor = drawer.getByRole("textbox", { name: "Edit README.md" });
    const draft = "# Unsaved editor draft";
    await editor.fill(draft);

    await setLayout(page, mode);
    const hide = dock.getByRole("button", { name: "Hide workspace terminal" });
    const move = dock.getByRole("button", { name: "Move to side panel" });
    const geometry = await page.evaluate(() => {
      const selectors = [
        ".app",
        ".stage",
        ".workspace-context",
        ".chat-stream",
        ".composer-wrap",
        ".composer",
        ".submit-btn",
        ".statusline",
        ".terminal-dock",
      ];
      return Object.fromEntries(
        selectors.map((selector) => {
          const el = document.querySelector(selector)!;
          const s = getComputedStyle(el);
          return [
            selector,
            {
              rect: el.getBoundingClientRect().toJSON(),
              scrollHeight: el.scrollHeight,
              clientHeight: el.clientHeight,
              overflowY: s.overflowY,
              flex: s.flex,
              minHeight: s.minHeight,
            },
          ];
        }),
      );
    });
    const geometryPath = testInfo.outputPath("short-dock-geometry.json");
    await writeFile(geometryPath, JSON.stringify(geometry, null, 2));
    await testInfo.attach("short-dock-geometry", {
      path: geometryPath,
      contentType: "application/json",
    });
    // This failed on the published layout: the composer intercepted Hide.
    // Do not scroll or dismiss anything before checking the dock boundary.
    await expectHit(hide);
    await expectHit(move);
    await expectHit(
      page.getByRole("button", { name: "Show files", exact: true }),
    );
    await expectHit(drawer.getByRole("button", { name: "Close drawer" }));

    // Files has its own scrollport; a clipped first line is ordinarily scrollable.
    const line = editor.locator(".cm-line").first();
    await line.scrollIntoViewIfNeeded();
    await expectHit(line);
    await line.click();
    await expect(editor).toBeFocused();
    await expectEditorText(editor, draft);
    await hide.click();
    await expect(dock).toHaveCount(0);
    await page.keyboard.press("Control+Backquote");
    await expect(dock.locator(".xterm-helper-textarea")).toBeFocused();
    await expect(dock.locator("[data-terminal]")).toHaveAttribute(
      "data-terminal",
      terminalId!,
    );
    await expectEditorText(editor, draft);
    await drawer.getByRole("button", { name: "Close drawer" }).click();

    // The overlay is dismissed, so every composer control must be reachable,
    // allowing normal scrolling inside the short stage rather than clipping it.
    await composer.scrollIntoViewIfNeeded();
    await expectHit(composer);
    await composer.click();
    await expect(composer).toBeFocused();
    await expect(composer).toHaveValue(composerDraft);
    const controls = page.locator(".composer button:visible");
    for (const control of await controls.all()) {
      await control.scrollIntoViewIfNeeded();
      await expectHit(control);
      await expectHit(hide);
      await expectHit(move);
    }
    const more = page.locator(".composer-more-trigger");
    await more.scrollIntoViewIfNeeded();
    await expectHit(more);
    await more.click();
    await expect(
      page.locator(".composer-more-menu button").first(),
    ).toBeVisible();
    for (const control of await page
      .locator(".composer-more-menu button:visible")
      .all()) {
      await control.scrollIntoViewIfNeeded();
      await expectHit(control);
    }
    await more.press("Escape");
    const permission = page.getByRole("button", {
      name: "Permissions: Ask before actions",
    });
    await permission.click();
    await expect(page.locator(".composer-popover")).toBeVisible();
    for (const control of await page
      .locator(".composer-popover input, .composer-popover button")
      .all()) {
      await control.scrollIntoViewIfNeeded();
      await expectHit(control);
    }
    await permission.press("Escape");
    const picker = page.getByRole("button", { name: /Model for this task/ });
    await picker.click();
    const search = page.getByRole("combobox", { name: "Search models" });
    await search.scrollIntoViewIfNeeded();
    await expectHit(search);
    await search.press("Escape");
    await composer.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath("short-dock-composer.png"),
    });
    const projectControl = page.getByRole("button", {
      name: "Show running processes",
      exact: true,
    });
    await projectControl.scrollIntoViewIfNeeded();
    await expectHit(projectControl);
    await expectHit(
      page.getByRole("button", { name: "Show files", exact: true }),
    );
    await page.keyboard.press("Control+Backquote");
    await expect(dock.locator(".xterm-helper-textarea")).toBeFocused();
    await page.keyboard.type("echo short-dock-state-still-alive");
    await expect(dock.locator(".xterm-rows")).toContainText(
      "short-dock-state-still-alive",
    );
    await page.keyboard.press("Enter");
    // At this height xterm may have just one row; the prompt can scroll the
    // result out of view. Check the actual fixture response, then its replay
    // into the larger terminal below, rather than demanding two visible rows.
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as any).__SHADOW_FAKE__.tools.terminals[0].output,
        ),
      )
      .toContain("\r\nshort-dock-state-still-alive\r\n");
    await expect(dock.locator("[data-terminal]")).toHaveAttribute(
      "data-terminal",
      terminalId!,
    );
    await move.click();
    await expect(dock).toHaveCount(0);
    await expect(page.locator("[data-terminal]")).toHaveAttribute(
      "data-terminal",
      terminalId!,
    );
    await page.getByRole("button", { name: "Show files", exact: true }).focus();
    await page.keyboard.press("Control+0");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(page.locator(".xterm-rows")).toContainText(
      "short-dock-state-still-alive",
    );
    await page.getByRole("button", { name: "Show files", exact: true }).click();
    await expectEditorText(editor, draft);
    await expect(composer).toHaveValue(composerDraft);
    expect(
      await page.evaluate(() => {
        const fake = (window as any).__SHADOW_FAKE__;
        return {
          shells: fake.tools.terminals.length,
          saved: fake.state.files["README.md"],
          creates: fake.log.filter(
            (call: any) =>
              call.method === "POST" && call.path === "/api/terminals",
          ).length,
        };
      }),
    ).toEqual({ shells: 1, saved: "# Demo\n", creates: 1 });
  });
}

async function prepareShortConversation(page: Page, mode: Layout) {
  await page.addInitScript(installFakeBackend, {
    stepMs: 60,
    network: "offline",
  });
  await page.addInitScript(installFakeTools, {});
  await page.addInitScript(installFakePerformance, { messages: 40 });
  await page.addInitScript(() => {
    for (let i = 0; i < 24; i++)
      (window as any).__SHADOW_FAKE__.state.files[
        `qualification-${String(i).padStart(2, "0")}.ts`
      ] = "export {};\n";
  });
  if (mode.fallback) await withoutSizeQueries(page);
  await page.goto("/");
  await page.locator('.task-link[data-session-id="s1"]').click();
  await expect(page.locator(".msg-agent").last()).toContainText(
    "Saved message 00040.",
  );
  await page.getByRole("button", { name: "Hide sidebar", exact: true }).click();
  await page
    .getByRole("button", { name: "Show terminal", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Dock terminal below workspace" })
    .click();
  await page.getByRole("button", { name: "Close drawer" }).click();
  await setLayout(page, mode);
}

for (const mode of layouts) {
  test(`short dock suggestions remain usable with wheel, keys and pointer: ${mode.name}`, async ({
    page,
  }) => {
    await prepareShortConversation(page, mode);
    const composer = page.getByRole("textbox", { name: "Message ShadowCode" });
    const stage = page.locator("main.stage");
    for (const query of ["/", "Inspect @qualification-"]) {
      for (const edge of ["first", "last"]) {
        for (const input of ["keyboard", "pointer"]) {
          // Picking a suggestion restores the caret on the next frame. Let
          // that finish before clearing it for the next independent scenario.
          await page.evaluate(
            () =>
              new Promise<void>((resolve) =>
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => resolve()),
                ),
              ),
          );
          await composer.fill("");
          await expect(composer).toHaveValue("");
          await composer.pressSequentially(query);
          const menu = page.getByRole("listbox", {
            name: query === "/" ? "Slash commands" : "Mentions",
          });
          const options = menu.getByRole("option");
          await expect.poll(() => options.count()).toBeGreaterThanOrEqual(8);
          const count = await options.count();
          const option = edge === "first" ? options.first() : options.last();
          const label = (await option.locator("strong").textContent())!;
          if (input === "keyboard") {
            for (let i = 1; edge === "last" && i < count; i++)
              await page.keyboard.press("ArrowDown");
            await expect(option).toHaveAttribute("aria-selected", "true");
          }
          await wheelTo(option, stage);
          await expectHit(option);
          if (input === "keyboard") await page.keyboard.press("Enter");
          else await option.click();
          await expect(menu).toHaveCount(0);
          await expect(composer).toHaveValue(
            query === "/"
              ? new RegExp(`^${label.trim()}\\s*$`)
              : `Inspect @${label.trim()} `,
          );
        }
      }
    }
    const picker = page.getByRole("button", { name: /Model for this task/ });
    await wheelTo(picker, stage);
    await picker.click();
    const search = page.getByRole("combobox", { name: "Search models" });
    await search.press("End");
    const models = page
      .getByRole("listbox", { name: "Models" })
      .getByRole("option");
    const last = models.last();
    await expect(last).toContainText("Show all 40 OpenRouter models");
    await expect(search).toHaveAttribute(
      "aria-activedescendant",
      (await last.getAttribute("id"))!,
    );
    await wheelTo(last, stage);
    await expectHit(last);
    const shown = await models.count();
    await last.click();
    await expect.poll(() => models.count()).toBeGreaterThan(shown);
    await search.press("End");
    const finalModel = models.last();
    const name = (await finalModel
      .locator(".unified-picker-name strong")
      .textContent())!;
    await wheelTo(finalModel, stage);
    await expectHit(finalModel);
    await finalModel.click();
    // Cloud rows honestly remain unavailable in this offline fixture; clicking
    // the last row must expose its reason rather than pretend to select it.
    await expect(page.locator(".unified-picker-details")).toContainText(name);
    const addLocal = page.getByRole("button", {
      name: "Add local model…",
      exact: true,
    });
    await wheelTo(addLocal, stage);
    await expectHit(addLocal);
    await addLocal.click();
    await expect(search).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Local models", exact: true }),
    ).toBeVisible();
  });

  test(`short dock Latest activity remains reachable in a populated conversation: ${mode.name}`, async ({
    page,
  }) => {
    await prepareShortConversation(page, mode);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const stream = page.locator(".chat-stream");
    const stage = page.locator("main.stage");
    await wheelTo(stream, stage);
    const box = (await stream.boundingBox())!;
    const pane = (await stage.boundingBox())!;
    await page.mouse.move(
      box.x + box.width / 2,
      Math.min(box.y + box.height / 2, pane.y + pane.height - 10),
    );
    await page.mouse.wheel(0, -600);
    const latest = page.getByRole("button", {
      name: "Latest activity",
      exact: true,
    });
    await expect(latest).toBeVisible();
    await wheelTo(latest, stage);
    await expectHit(latest);
    await latest.click();
    await expect
      .poll(() =>
        stream.evaluate(
          (el) => el.scrollHeight - el.scrollTop - el.clientHeight,
        ),
      )
      .toBeLessThan(2);
    await expect(latest).toHaveCount(0);
    await expect(page.locator(".msg-agent").last()).toBeInViewport();
    await expectHit(
      page.getByRole("button", { name: "Hide workspace terminal" }),
    );
  });
}
