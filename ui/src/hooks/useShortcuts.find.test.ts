import { afterEach, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import {
  shortcutFor,
  useShortcuts,
  type ShortcutContext,
} from "./useShortcuts";

afterEach(cleanup);

const closed: ShortcutContext = {
  consent: false,
  overlay: false,
  trust: false,
  picker: false,
  panel: false,
  onboarding: false,
};
const press = (
  target: Element,
  extra: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {},
  open = closed,
) =>
  shortcutFor(
    {
      key: "f",
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      target,
      ...extra,
    },
    open,
  );

it("Ctrl+F finds in the conversation, also from the composer", () => {
  expect(press(document.body, { ctrlKey: true })).toBe("find");
  expect(press(document.body, { metaKey: true })).toBe("find");
  expect(press(document.createElement("textarea"), { ctrlKey: true })).toBe(
    "find",
  );
  expect(press(document.body)).toBeNull();
  expect(press(document.body, { ctrlKey: true, shiftKey: true })).toBeNull();
});

it("leaves Ctrl+F to a terminal, a dialog and an open overlay", () => {
  const terminal = document.createElement("div");
  terminal.dataset.terminal = "t";
  const input = document.createElement("textarea");
  terminal.append(input);
  expect(press(input, { ctrlKey: true })).toBeNull();
  const dialog = document.createElement("div");
  dialog.setAttribute("aria-modal", "true");
  const field = document.createElement("input");
  dialog.append(field);
  expect(press(field, { ctrlKey: true })).toBeNull();
  expect(
    press(document.body, { ctrlKey: true }, { ...closed, overlay: true }),
  ).toBeNull();
});

it("a code editor's own find (which handles the key first) wins", () => {
  const run = vi.fn();
  renderHook(() => useShortcuts(closed, run));
  const editor = document.createElement("div");
  editor.className = "cm-editor";
  document.body.append(editor);
  editor.addEventListener("keydown", (e) => e.preventDefault(), {
    once: true,
  });
  const key = () =>
    new KeyboardEvent("keydown", {
      key: "f",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
  editor.dispatchEvent(key());
  expect(run).not.toHaveBeenCalled();
  document.body.dispatchEvent(key());
  expect(run).toHaveBeenCalledWith("find");
  editor.remove();
});
