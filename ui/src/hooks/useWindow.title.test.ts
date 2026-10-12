import { renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { useWindowTitle, windowTitle } from "./useWindow";

it("names the open conversation, with a dot while a task runs", () => {
  expect(windowTitle("Fix the add function", false)).toBe(
    "Fix the add function — ShadowCode",
  );
  expect(windowTitle("Fix the add function", true)).toBe(
    "● Fix the add function — ShadowCode",
  );
  expect(windowTitle(undefined, false)).toBe("ShadowCode");
  expect(windowTitle("   ", true)).toBe("● ShadowCode");
  // One line, however the title was typed.
  expect(windowTitle("  Two\nlines  ", false)).toBe("Two lines — ShadowCode");
});

it("keeps the document title in step", () => {
  const { rerender } = renderHook(
    ({ title, busy }: { title: string | undefined; busy: boolean }) =>
      useWindowTitle(title, busy),
    {
      initialProps: {
        title: "Release notes" as string | undefined,
        busy: true,
      },
    },
  );
  expect(document.title).toBe("● Release notes — ShadowCode");
  rerender({ title: "Release notes", busy: false });
  expect(document.title).toBe("Release notes — ShadowCode");
  rerender({ title: undefined, busy: false });
  expect(document.title).toBe("ShadowCode");
});
