import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";

// The desktop's webview, and which bridge the window runs on.
const setZoom = vi.fn<(zoom: number) => Promise<void>>();
let kind = "none";
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ setZoom }),
}));
vi.mock("../lib/transport", () => ({ transportKind: () => kind }));

// Module state (the size in use) starts over in every test.
const load = () => import("./useZoom");
const root = () => document.documentElement.style;

beforeEach(() => {
  vi.resetModules();
  kind = "none";
  setZoom.mockReset().mockResolvedValue(undefined);
  localStorage.clear();
  root().removeProperty("zoom");
  root().removeProperty("--zoom");
});
afterEach(() => cleanup());

it("zooms a plain browser with CSS and tells the terminal", async () => {
  const { applyZoom, cssZoom, currentZoom, onCssZoom } = await load();
  const heard: number[] = [];
  const stop = onCssZoom((zoom) => heard.push(zoom));
  applyZoom(1.25);
  expect(root().zoom).toBe("1.25");
  expect(root().getPropertyValue("--zoom")).toBe("1.25");
  expect([currentZoom(), cssZoom()]).toEqual([1.25, 1.25]);
  applyZoom(1.25);
  applyZoom(1);
  expect(root().zoom).toBe("");
  expect(root().getPropertyValue("--zoom")).toBe("");
  stop();
  applyZoom(0.9);
  expect(heard).toEqual([1.25, 1]);
  expect(setZoom).not.toHaveBeenCalled();
});

it("zooms the desktop's webview and leaves CSS alone", async () => {
  kind = "tauri";
  const { applyZoom, cssZoom, currentZoom } = await load();
  applyZoom(1.5);
  await vi.waitFor(() => expect(setZoom).toHaveBeenCalledWith(1.5));
  expect(root().zoom).toBe("");
  expect([currentZoom(), cssZoom()]).toEqual([1.5, 1]);
});

it("falls back to CSS when the desktop refuses to zoom its webview", async () => {
  kind = "tauri";
  setZoom.mockRejectedValue(new Error("not allowed"));
  const { applyZoom, cssZoom } = await load();
  applyZoom(1.1);
  await vi.waitFor(() => expect(root().zoom).toBe("1.1"));
  expect(cssZoom()).toBe(1.1);
  // It does not ask again.
  applyZoom(1.25);
  expect(root().zoom).toBe("1.25");
  expect(setZoom).toHaveBeenCalledTimes(1);
});

it("opens at the remembered size, and remembers only the saved one", async () => {
  localStorage.setItem("shadow:zoom", "1.5");
  const { applyInitialZoom, currentZoom, useZoom, ZOOM_KEY } = await load();
  applyInitialZoom();
  expect(root().zoom).toBe("1.5");
  // Until the config has loaded the startup size stays.
  const { rerender } = renderHook(({ zoom, saved }) => useZoom(zoom, saved), {
    initialProps: {
      zoom: undefined as number | undefined,
      saved: undefined as number | undefined,
    },
  });
  expect(currentZoom()).toBe(1.5);
  rerender({ zoom: 1.1, saved: 1.1 });
  expect(root().zoom).toBe("1.1");
  expect(localStorage.getItem(ZOOM_KEY)).toBe("1.1");
  // A preview shows without being remembered for the next start.
  rerender({ zoom: 1.75, saved: 1.1 });
  expect(root().zoom).toBe("1.75");
  expect(localStorage.getItem(ZOOM_KEY)).toBe("1.1");
});

it("opens at 100% when nothing usable was remembered", async () => {
  localStorage.setItem("shadow:zoom", "huge");
  const { applyInitialZoom, currentZoom } = await load();
  applyInitialZoom();
  expect(currentZoom()).toBe(1);
  expect(root().zoom).toBe("");
});
