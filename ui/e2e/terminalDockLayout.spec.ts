import { test, expect, type Locator, type Page } from "@playwright/test";
import { installFakeBackend } from "./fakeBackend";
import { installFakeTools } from "./fakeTools";

const parentPath = String.raw`C:\Users\Robert\AppData\Local\ShadowCode\qualification\candidate-3984b7f\workspaces\terminal-layout`;
const notice =
  "It runs outside the agent's sandbox, keeps running while the agent works, and the agent never sees it.";
const failure =
  "Could not open another shell: " + "configuration unavailable; ".repeat(16);
async function hit(control: Locator) {
  await expect
    .poll(() =>
      control.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const target = document.elementFromPoint(
          r.x + r.width / 2,
          r.y + r.height / 2,
        );
        return Boolean(target && el.contains(target));
      }),
    )
    .toBe(true);
}
/** Check the last text line inside its actual scrollport, not just DOM presence. */
async function textEndVisible(text: Locator) {
  return text.evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let last: Node | null = null;
    while (walker.nextNode())
      if (walker.currentNode.textContent?.trim()) last = walker.currentNode;
    if (!last) return false;
    const range = document.createRange();
    const length = last.textContent!.trimEnd().length;
    range.setStart(last, Math.max(0, length - 5));
    range.setEnd(last, length);
    const rect = range.getBoundingClientRect();
    const port = el.closest(".terminal-controls")!.getBoundingClientRect();
    const hit = document.elementFromPoint(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
    );
    return (
      rect.top >= port.top - 1 &&
      rect.bottom <= port.bottom + 1 &&
      Boolean(hit && el.contains(hit))
    );
  });
}
async function geometry(page: Page) {
  return page.locator(".terminal-dock").evaluate((dock) => {
    const pane = dock.getBoundingClientRect();
    const host = dock.querySelector<HTMLElement>(".terminal-screen")!;
    const box = host.getBoundingClientRect();
    const screen = dock.querySelector(".xterm-screen")!.getBoundingClientRect();
    const rows = [...dock.querySelectorAll(".xterm-rows > div")];
    const row = rows.at(-1)!.getBoundingClientRect();
    const css = getComputedStyle(host);
    const zoom = Number(document.documentElement.style.zoom || 1);
    const innerTop =
      box.top +
      (parseFloat(css.paddingTop) + parseFloat(css.borderTopWidth)) * zoom;
    const innerBottom =
      box.bottom -
      (parseFloat(css.paddingBottom) + parseFloat(css.borderBottomWidth)) *
        zoom;
    return {
      pane: pane.toJSON(),
      host: box.toJSON(),
      screen: screen.toJSON(),
      row: row.toJSON(),
      rows: rows.length,
      innerTop,
      innerBottom,
      zoom,
      completeRows: rows.length >= 2 && screen.height >= 2 * row.height - 1,
      contained:
        screen.top >= innerTop - 1 &&
        screen.bottom <= innerBottom + 1 &&
        row.bottom <= innerBottom + 1 &&
        box.bottom <= pane.bottom + 1 &&
        pane.bottom <= innerHeight + 1,
    };
  });
}
for (const layout of [
  { name: "native effective 627x545", width: 627, height: 545, zoom: 1 },
  {
    name: "CSS zoom 125 percent measured client",
    width: 784,
    height: 681,
    zoom: 1.25,
  },
]) {
  for (const stress of [false, true]) {
    test(`terminal dock reserves complete rows: ${layout.name}, ${stress ? "long basename errors tabs and exit" : "Windows path"}`, async ({
      page,
      browserName,
    }, info) => {
      const basename = stress
        ? "project_" + "long_name_".repeat(22)
        : "project";
      const workspace = `${parentPath}\\${basename}\\`;
      await page.addInitScript(installFakeBackend, {});
      await page.addInitScript(installFakeTools, {});
      await page.addInitScript(
        ({ workspace, failure }) => {
          const win = window as any;
          const transport = win.__SHADOW_TEST_TRANSPORT__;
          const original = transport.request.bind(transport);
          const rewrite = (value: any): any => {
            if (typeof value === "string")
              return value.replaceAll("/work/demo", workspace);
            if (Array.isArray(value)) return value.map(rewrite);
            if (value && typeof value === "object")
              return Object.fromEntries(
                Object.entries(value).map(([k, v]) => [k, rewrite(v)]),
              );
            return value;
          };
          transport.request = async (
            path: string,
            method: string,
            body: unknown,
          ) => {
            if (
              path === "/api/terminals" &&
              method === "POST" &&
              win.__FAIL_NEW_TERMINAL__
            )
              throw new Error(failure);
            // Translate only the fixture boundary; the UI still sends the full
            // Windows workspace. Record that request before adapting the fake.
            (win.__TERMINAL_WORKSPACE_REQUESTS__ ||= []).push(path);
            const fixturePath = path.replaceAll(
              encodeURIComponent(workspace),
              encodeURIComponent("/work/demo"),
            );
            return rewrite(await original(fixturePath, method, body));
          };
        },
        { workspace, failure },
      );
      await page.goto("/");
      await page
        .getByRole("button", { name: "Show terminal", exact: true })
        .click();
      await expect(page.locator(".xterm-rows")).toContainText("demo$");
      if (stress) {
        for (let i = 0; i < 9; i++) {
          await page
            .getByRole("button", { name: "New terminal", exact: true })
            .click();
          await expect(
            page.getByRole("group", { name: `Terminal ${i + 2}`, exact: true }),
          ).toBeVisible();
        }
      }
      await page
        .getByRole("button", { name: "Dock terminal below workspace" })
        .click();
      const dock = page.getByRole("region", {
        name: "Workspace terminal",
        exact: true,
      });
      if (stress) {
        await page.evaluate(() => {
          (window as any).__FAIL_NEW_TERMINAL__ = true;
        });
        await page
          .getByRole("button", { name: "New terminal", exact: true })
          .click();
        await expect(dock.getByRole("alert")).toContainText(failure);
      }
      await page.setViewportSize({
        width: layout.width,
        height: layout.height,
      });
      await dock
        .getByRole("button", { name: "Hide workspace terminal" })
        .focus();
      if (layout.zoom > 1) {
        await page.keyboard.press("Control+Equal");
        await page.keyboard.press("Control+Equal");
      }
      await expect
        .poll(() =>
          page.evaluate(() => Number(document.documentElement.style.zoom || 1)),
        )
        .toBe(layout.zoom);
      try {
        await expect
          .poll(async () => {
            const g = await geometry(page);
            return { completeRows: g.completeRows, contained: g.contained };
          })
          .toEqual({ completeRows: true, contained: true });
      } finally {
        await info.attach("terminal-geometry", {
          contentType: "application/json",
          body: JSON.stringify(await geometry(page), null, 2),
        });
      }
      const controls = dock.getByRole("region", {
        name: "Terminal controls and notices",
      });
      await expect(controls.locator(".terminal-hint")).toHaveText(
        `Your own shell in ${basename}. ${notice}`,
      );
      for (const name of ["Hide workspace terminal", "Move to side panel"])
        await hit(dock.getByRole("button", { name, exact: true }));
      if (stress) {
        // Real Tab navigation reaches the last tab even when rows are clipped.
        await controls.focus();
        const lastTab = controls.getByRole("button", {
          name: "Terminal 10",
          exact: true,
        });
        const focusPath: unknown[] = [];
        for (
          let i = 0;
          i < 24 &&
          !(await lastTab.evaluate((el) => el === document.activeElement));
          i++
        ) {
          // WebKit on macOS uses Option+Tab to include buttons, while
          // plain Tab goes to the terminal textarea and is consumed there.
          await page.keyboard.press(
            browserName === "webkit" && process.platform === "darwin"
              ? "Alt+Tab"
              : "Tab",
          );
          focusPath.push(
            await page.evaluate(() => ({
              tag: document.activeElement?.tagName,
              label: document.activeElement?.getAttribute("aria-label"),
              text: document.activeElement?.textContent?.slice(0, 80),
            })),
          );
        }
        await info.attach("terminal-tab-focus-path", {
          contentType: "application/json",
          body: JSON.stringify(focusPath),
        });
        await expect(lastTab).toBeFocused();
        await hit(lastTab);
        await lastTab.click();
      }
      await controls.focus();
      await page.keyboard.press("Home");
      for (
        let i = 0;
        i < 30 && !(await textEndVisible(controls.locator(".terminal-hint")));
        i++
      ) {
        await controls.hover();
        await page.mouse.wheel(0, 24);
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve()),
              ),
            ),
        );
      }
      await expect
        .poll(() => textEndVisible(controls.locator(".terminal-hint")))
        .toBe(true);
      await controls.focus();
      await page.keyboard.press("End");
      await expect
        .poll(() =>
          controls.evaluate(
            (el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 2,
          ),
        )
        .toBe(true);
      await expect(controls).toContainText(notice);
      if (stress) {
        await expect(controls.getByRole("alert")).toContainText(failure);
        await expect
          .poll(() => textEndVisible(controls.getByRole("alert")))
          .toBe(true);
        expect(
          await controls.evaluate((el) => el.scrollHeight > el.clientHeight),
        ).toBe(true);
      }
      const scrolled = await controls.evaluate((el) => el.scrollTop);
      await controls.hover();
      await page.mouse.wheel(0, -2000);
      if (stress)
        await expect
          .poll(() => controls.evaluate((el) => el.scrollTop))
          .toBeLessThan(scrolled);
      else {
        await controls.focus();
        await page.keyboard.press("Home");
      }
      await hit(
        controls.getByRole("button", { name: "Terminal 1", exact: true }),
      );
      await controls
        .getByRole("button", { name: "Terminal 1", exact: true })
        .click();
      await expect(
        dock.getByRole("group", { name: "Terminal 1", exact: true }),
      ).toBeVisible();
      await dock.locator(".terminal-screen").click();
      for (let i = 0; i < 5; i++) {
        await page.keyboard.type(`echo visible-row-${i}`);
        await page.keyboard.press("Enter");
      }
      await expect(dock.locator(".xterm-rows")).toContainText("visible-row-4");
      if (stress) {
        await page.keyboard.type("exit");
        await page.keyboard.press("Enter");
        const restart = controls.getByRole("button", {
          name: "Restart",
          exact: true,
        });
        await expect(restart).toBeAttached();
        await controls.focus();
        await page.keyboard.press("End");
        await hit(restart);
        await expect
          .poll(async () => (await geometry(page)).contained)
          .toBe(true);
        await page.evaluate(() => {
          (window as any).__FAIL_NEW_TERMINAL__ = false;
        });
        await restart.click();
        await expect(dock.locator(".terminal-exited")).toHaveCount(0);
        await expect
          .poll(async () => (await geometry(page)).completeRows)
          .toBe(true);
      }
      await info.attach("terminal-final", {
        contentType: "application/json",
        body: JSON.stringify(await geometry(page), null, 2),
      });
      await info.attach("terminal-screen", {
        contentType: "image/png",
        body: await page.screenshot(),
      });
      const count = await page.evaluate(
        () => (window as any).__SHADOW_FAKE__.tools.terminals.length,
      );
      await dock
        .getByRole("button", { name: "Hide workspace terminal" })
        .click();
      await page
        .getByRole("button", { name: "Show terminal", exact: true })
        .click();
      await expect(dock).toBeVisible();
      await dock.getByRole("button", { name: "Move to side panel" }).click();
      await expect(dock).toHaveCount(0);
      expect(
        await page.evaluate(
          () => (window as any).__TERMINAL_WORKSPACE_REQUESTS__,
        ),
      ).toContain(
        `/api/workspace/editor-drafts?workspace=${encodeURIComponent(workspace)}`,
      );
      expect(
        await page.evaluate(
          () => (window as any).__SHADOW_FAKE__.tools.terminals.length,
        ),
      ).toBe(count);
    });
  }
}
