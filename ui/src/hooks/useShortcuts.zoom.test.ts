import { afterEach, expect, it } from "vitest";
import { shortcutFor, type ShortcutContext } from "./useShortcuts";

const closed: ShortcutContext = {
  consent: false,
  overlay: false,
  trust: false,
  picker: false,
  panel: false,
  onboarding: false,
};
const press = (
  key: string,
  extra: Partial<KeyboardEvent> = {},
  open: ShortcutContext = closed,
) =>
  shortcutFor(
    {
      key,
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      target: document.body,
      ...extra,
    } as KeyboardEvent,
    open,
  );

afterEach(() => {
  document.body.innerHTML = "";
});

it("zooms with Ctrl+= / Ctrl++, Ctrl+- and Ctrl+0, Shift and keypad included", () => {
  expect(press("=")).toBe("zoom-in");
  // Ctrl+Shift+= and the keypad's + both arrive as "+".
  expect(press("+", { shiftKey: true })).toBe("zoom-in");
  expect(press("+")).toBe("zoom-in");
  expect(press("=", { ctrlKey: false, metaKey: true })).toBe("zoom-in");
  // The keypad's - is "-" too; Ctrl+Shift+- arrives as "_".
  expect(press("-")).toBe("zoom-out");
  expect(press("_", { shiftKey: true })).toBe("zoom-out");
  expect(press("0")).toBe("zoom-reset");
  // Without Ctrl, or with Alt, the keys type.
  expect(press("=", { ctrlKey: false })).toBeNull();
  expect(press("0", { ctrlKey: false })).toBeNull();
  expect(press("-", { altKey: true })).toBeNull();
});

it("zooms from the composer and the editor, but not in a terminal or a dialog", () => {
  const composer = document.createElement("textarea");
  const editor = document.createElement("div");
  editor.setAttribute("contenteditable", "true");
  document.body.append(composer, editor);
  expect(press("=", { target: composer })).toBe("zoom-in");
  expect(press("-", { target: editor })).toBe("zoom-out");
  // Ctrl+- is readline's undo in a shell.
  const screen = document.createElement("div");
  screen.dataset.terminal = "t1";
  const input = document.createElement("textarea");
  screen.append(input);
  document.body.append(screen);
  for (const key of ["=", "-", "0"])
    expect(press(key, { target: input })).toBeNull();
  // Modal dialogs and tracked overlays own the keyboard.
  const modal = document.createElement("div");
  modal.setAttribute("aria-modal", "true");
  const button = document.createElement("button");
  modal.append(button);
  document.body.append(modal);
  expect(press("=", { target: button })).toBeNull();
  for (const open of ["overlay", "trust", "consent", "onboarding"] as const)
    expect(press("=", {}, { ...closed, [open]: true })).toBeNull();
  // An open drawer or picker does not stop it.
  expect(press("0", {}, { ...closed, panel: true, picker: true })).toBe(
    "zoom-reset",
  );
});
