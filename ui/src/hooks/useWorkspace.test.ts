import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installFakeBackend } from "../../e2e/fakeBackend";
import { useAppearance, ZOOM_SAVE_DELAY_MS } from "./useAppearance";
import { useWorkspace } from "./useWorkspace";
import { api } from "../api";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.style.removeProperty("zoom");
  delete document.documentElement.dataset.theme;
  vi.stubEnv("VITE_SHADOW_TEST_TRANSPORT", "1");
  const fake = installFakeBackend();
  fake.state.config.ui = { theme: "light", zoom: 1 };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  document.documentElement.style.removeProperty("zoom");
  delete document.documentElement.dataset.theme;
  delete window.__SHADOW_TEST_TRANSPORT__;
});

async function setup() {
  const toast = vi.fn();
  const jobs = vi.fn();
  const { result } = renderHook(() => {
    const ws = useWorkspace(jobs);
    const appearance = useAppearance({
      cfg: ws.cfg,
      loaded: ws.configLoaded,
      reloadConfig: ws.reloadConfig,
      toast,
    });
    return { ws, appearance };
  });
  await act(async () => {
    await result.current.ws.reloadConfig();
  });
  return { result, toast };
}

it.each(["theme", "zoom"] as const)(
  "reloads real workspace config after an object-valued %s save without an error toast",
  async (kind) => {
    const { result, toast } = await setup();
    const save = vi.spyOn(api, "saveConfig");
    if (kind === "theme") {
      await act(async () => {
        result.current.appearance.setTheme("dark");
      });
    } else {
      vi.useFakeTimers();
      act(() => result.current.appearance.zoom(1));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ZOOM_SAVE_DELAY_MS);
      });
    }
    // A real save returns an object, which Promise.then passes as an argument
    // to reloadConfig. Public callbacks must keep ignoring such arguments.
    expect(await save.mock.results[0].value).toBeTypeOf("object");
    expect(result.current.ws.cfg.ui).toMatchObject(
      kind === "theme" ? { theme: "dark" } : { zoom: 1.1 },
    );
    expect(toast).not.toHaveBeenCalled();
    expect(
      kind === "theme"
        ? document.documentElement.dataset.theme
        : document.documentElement.style.zoom,
    ).toBe(kind === "theme" ? "dark" : "1.1");
  },
);

it("keeps refresh usable as a Promise callback that receives a result object", async () => {
  const { result } = await setup();
  await act(async () => {
    await Promise.resolve({ ok: true }).then(result.current.ws.refresh);
  });
  expect(result.current.ws.sessions.map((s) => s.id)).toEqual(["s1"]);
  expect(result.current.ws.status?.workspace).toBe("/work/demo");
});
