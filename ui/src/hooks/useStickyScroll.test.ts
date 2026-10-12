import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useStickyScroll } from "./useStickyScroll";
import { scrollBehavior } from "../lib/motion";

let reduce = false;
beforeEach(() => {
  reduce = false;
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        media: query,
        matches: query === "(prefers-reduced-motion: reduce)" && reduce,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function stream() {
  const { result } = renderHook(() =>
    useStickyScroll({
      active: true,
      content: [],
      historyViewing: false,
      historyCursor: 0,
    }),
  );
  const el = document.createElement("div");
  Object.defineProperty(el, "scrollHeight", { value: 4000 });
  el.scrollTo = vi.fn() as typeof el.scrollTo;
  result.current.streamRef.current = el;
  return { result, scrollTo: vi.mocked(el.scrollTo) };
}

it("scrolls to the latest activity smoothly", () => {
  const { result, scrollTo } = stream();
  act(() => result.current.jumpToLatest());
  expect(scrollTo).toHaveBeenCalledWith({ top: 4000, behavior: "smooth" });
  expect(result.current.atBottom).toBe(true);
});

it("jumps instead when the system asks for reduced motion", () => {
  reduce = true;
  expect(scrollBehavior()).toBe("auto");
  const { result, scrollTo } = stream();
  act(() => result.current.jumpToLatest());
  expect(scrollTo).toHaveBeenCalledWith({ top: 4000, behavior: "auto" });
});
