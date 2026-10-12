import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

const saveConfig = vi.fn<(values: Record<string, unknown>) => Promise<void>>();
vi.mock("../api", () => ({ api: { saveConfig: (v: never) => saveConfig(v) } }));

type Props = { cfg: Record<string, unknown>; loaded: boolean };
const zoom = () => document.documentElement.style.zoom || "1";
const theme = () => document.documentElement.dataset.theme;

/** The window over a fake engine whose `ui` group saves merge into, and
 * whose reload hands the window the stored group. */
async function mount(ui: Record<string, unknown> = { theme: "light" }) {
  // Module state (the size in use) starts over in every test.
  vi.resetModules();
  const { useAppearance, ZOOM_SAVE_DELAY_MS } = await import("./useAppearance");
  const stored = { ...ui };
  saveConfig.mockImplementation(async (values) => {
    Object.assign(stored, values.ui);
  });
  const toast = vi.fn();
  let rerender = (_: Props) => {};
  const reread = () => rerender({ cfg: { ui: { ...stored } }, loaded: true });
  const reloadConfig = vi.fn(async () => reread());
  const hook = renderHook(
    ({ cfg, loaded }: Props) =>
      useAppearance({ cfg, loaded, reloadConfig, toast }),
    { initialProps: { cfg: { ui }, loaded: true } as Props },
  );
  rerender = hook.rerender;
  const wait = (ms = ZOOM_SAVE_DELAY_MS) =>
    act(() => vi.advanceTimersByTimeAsync(ms));
  return { ...hook, toast, reloadConfig, reread, wait };
}

beforeEach(() => {
  vi.useFakeTimers();
  saveConfig.mockReset();
  localStorage.clear();
  document.documentElement.style.removeProperty("zoom");
  delete document.documentElement.dataset.theme;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("zoom keys apply at once, say the size, and save once they stop", async () => {
  const { result, wait, reloadConfig } = await mount({ theme: "light" });
  expect(zoom()).toBe("1");
  act(() => result.current.zoom(1));
  act(() => result.current.zoom(1));
  expect(zoom()).toBe("1.25");
  expect(result.current.notice).toMatchObject({ zoom: 1.25, id: 2 });
  expect(saveConfig).not.toHaveBeenCalled();
  await wait();
  expect(saveConfig.mock.calls).toEqual([[{ ui: { zoom: 1.25 } }]]);
  expect(reloadConfig).toHaveBeenCalledOnce();
  expect(zoom()).toBe("1.25");
  expect(localStorage.getItem("shadow:zoom")).toBe("1.25");
  // At the largest size a press still says so, and saves nothing new.
  act(() => result.current.zoom(1));
  act(() => result.current.zoom(1));
  act(() => result.current.zoom(1));
  expect(zoom()).toBe("1.75");
  act(() => result.current.zoom(1));
  expect(result.current.notice).toMatchObject({ zoom: 1.75, id: 6 });
  await wait();
  expect(saveConfig).toHaveBeenLastCalledWith({ ui: { zoom: 1.75 } });
  expect(saveConfig).toHaveBeenCalledTimes(2);
  act(() => result.current.zoom(0));
  expect(zoom()).toBe("1");
});

it("a slow reload of an earlier step does not undo a later one", async () => {
  const { result, wait, reread, reloadConfig } = await mount();
  let finish = () => {};
  reloadConfig.mockImplementationOnce(
    () =>
      new Promise<void>((done) => {
        finish = () => {
          reread();
          done();
        };
      }),
  );
  act(() => result.current.zoom(1));
  await wait();
  expect(saveConfig).toHaveBeenLastCalledWith({ ui: { zoom: 1.1 } });
  // The second press lands while the first save is still being read back.
  act(() => result.current.zoom(1));
  await act(async () => finish());
  expect(zoom()).toBe("1.25");
  await wait();
  expect(saveConfig).toHaveBeenLastCalledWith({ ui: { zoom: 1.25 } });
  expect(zoom()).toBe("1.25");
});

it("a failed save goes back to the saved size and says why", async () => {
  const { result, wait, toast } = await mount({ theme: "light", zoom: 1.1 });
  saveConfig.mockRejectedValueOnce(new Error("disk full"));
  expect(zoom()).toBe("1.1");
  act(() => result.current.zoom(-1));
  expect(zoom()).toBe("1");
  await wait();
  expect(zoom()).toBe("1.1");
  expect(toast).toHaveBeenCalledWith("Error: disk full", "err");
});

it("a preview shows a theme and size without saving or remembering them", async () => {
  const { result } = await mount({ theme: "light", zoom: 1.1 });
  expect([theme(), zoom()]).toEqual(["light", "1.1"]);
  expect(result.current.controls).toMatchObject({ theme: "light", zoom: 1.1 });
  act(() => result.current.controls.preview({ theme: "dark", zoom: 1.5 }));
  expect([theme(), zoom()]).toEqual(["dark", "1.5"]);
  expect(localStorage.getItem("shadow:theme")).toBe("light");
  expect(localStorage.getItem("shadow:zoom")).toBe("1.1");
  act(() => result.current.controls.preview(null));
  expect([theme(), zoom()]).toEqual(["light", "1.1"]);
  expect(saveConfig).not.toHaveBeenCalled();
});

it("leaves the startup theme and size until the config loads", async () => {
  const { rerender, result } = await mount();
  document.documentElement.dataset.theme = "dark";
  document.documentElement.style.zoom = "1.5";
  act(() => rerender({ cfg: {}, loaded: false }));
  expect([theme(), zoom()]).toEqual(["dark", "1.5"]);
  expect(result.current.theme).toBe("system");
});

it("the palette saves a theme, System included", async () => {
  const { result, reloadConfig } = await mount({ theme: "dark" });
  expect(result.current.theme).toBe("dark");
  act(() => result.current.setTheme("system"));
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(saveConfig).toHaveBeenCalledWith({ ui: { theme: "system" } });
  expect(reloadConfig).toHaveBeenCalledOnce();
  expect(result.current.theme).toBe("system");
});
