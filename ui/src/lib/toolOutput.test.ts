import { describe, expect, it } from "vitest";
import {
  OUTPUT_MAX_CHARS,
  OUTPUT_MAX_LINES,
  OUTPUT_PREVIEW_CHARS,
  countLines,
  outputView,
  showAllLabel,
} from "./toolOutput";

const numbered = (count: number) =>
  Array.from({ length: count }, (_, i) => `line ${i + 1}`).join("\n");

describe("tool output", () => {
  it("counts lines; a final newline does not add one", () => {
    expect(countLines("")).toBe(0);
    expect(countLines("one")).toBe(1);
    expect(countLines("one\ntwo")).toBe(2);
    expect(countLines("one\ntwo\n")).toBe(2);
    expect(countLines("\n\n")).toBe(2);
  });

  it("short output shows as it is, with nothing to expand", () => {
    const view = outputView("Tests 4 passed (4)\n", false);
    expect(view).toEqual({
      text: "Tests 4 passed (4)\n",
      lines: 1,
      long: false,
    });
  });

  it("long output previews its start and expands to all of it", () => {
    const text = numbered(900);
    expect(text.length).toBeGreaterThan(OUTPUT_PREVIEW_CHARS);
    const preview = outputView(text, false);
    expect(preview.long).toBe(true);
    expect(preview.lines).toBe(900);
    expect(preview.text.startsWith("line 1\nline 2\n")).toBe(true);
    expect(preview.text.endsWith("\n…")).toBe(true);
    expect(preview.text.length).toBe(OUTPUT_PREVIEW_CHARS + 2);
    expect(showAllLabel(preview, text.length)).toBe("Show all (900 lines)");
    const all = outputView(text, true);
    expect(all.text).toBe(text);
    expect(all.hidden).toBeUndefined();
  });

  it("huge output keeps its last lines and says what is left out", () => {
    const text = `${numbered(OUTPUT_MAX_LINES + 500)}\n`;
    const view = outputView(text, true);
    expect(view.text.startsWith("…\nline 501\n")).toBe(true);
    expect(view.text.endsWith(`line ${OUTPUT_MAX_LINES + 500}\n`)).toBe(true);
    expect(countLines(view.text)).toBe(OUTPUT_MAX_LINES + 1);
    expect(view.hidden).toBe(
      "Showing the last 2,000 of 2,500 lines. Copy includes all of it.",
    );
    expect(showAllLabel(view, text.length)).toBe("Show all (2,500 lines)");
  });

  it("one enormous line is cut by characters", () => {
    const text = "x".repeat(OUTPUT_MAX_CHARS + 10);
    const view = outputView(text, true);
    expect(view.text).toBe(`…\n${"x".repeat(OUTPUT_MAX_CHARS)}`);
    expect(view.hidden).toBe(
      "Showing the last 200,000 of 200,010 characters. Copy includes all of it.",
    );
    expect(showAllLabel(outputView(text, false), text.length)).toBe(
      "Show all (200,010 characters)",
    );
  });
});
