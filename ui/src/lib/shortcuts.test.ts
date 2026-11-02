import { describe, expect, it } from "vitest";
import { shortcutHint, shortcutModifier } from "./shortcuts";

describe("keyboard shortcut hints", () => {
  it("uses Command for Mac and Apple external keyboards", () => {
    for (const platform of ["MacIntel", "MacPPC", "iPad", "iPhone"])
      expect(shortcutHint("Shift+Z", platform)).toBe("⌘+Shift+Z");
  });
  it("uses Control for Windows, Linux, and an unknown browser", () => {
    for (const platform of ["Win32", "Linux x86_64", "Linux aarch64", ""])
      expect(shortcutHint("S", platform)).toBe("Ctrl+S");
  });
  it("uses the viewing browser's keyboard instead of a remote engine platform", () => {
    expect(shortcutModifier(navigator.platform)).toBe(shortcutModifier());
  });
});
