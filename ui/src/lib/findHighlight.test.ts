import { afterEach, expect, it, vi } from "vitest";
import {
  FIND_CURRENT_ATTR,
  HIGHLIGHT_ALL,
  HIGHLIGHT_CURRENT,
  canHighlight,
  clearMatches,
  markRow,
  paintMatches,
  rangesIn,
  rowText,
  scrollToTarget,
  smoothScrolling,
} from "./findHighlight";

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function row(html: string): HTMLElement {
  document.body.innerHTML = `<div class="find-row" data-find-row="r">${html}</div>`;
  return document.querySelector("[data-find-row]")!;
}

const answer = () =>
  row(
    '<div class="msg-agent"><div class="who">Result</div>' +
      '<div class="markdown"><p>Fixed  the <strong>Bug</strong>.</p>\n' +
      '<div class="code-block"><button>Copy</button><pre><code>bug()\n</code></pre></div></div>' +
      '<div class="agent-actions"><button>Copy answer</button></div></div>',
  );

it("reads a row's drawn text: blocks apart, controls and labels left out", () => {
  expect(rowText(answer()).text).toBe("Fixed the Bug. bug() ");
  const prompt = row(
    '<div class="msg-user"><div class="user-pill"><div class="bubble">Fix\n\nthe bug</div>' +
      '<div class="message-actions"><button aria-label="Retry"></button></div></div></div>',
  );
  expect(rowText(prompt).text).toBe("Fix the bug");
  // A prompt being edited is a form, not the message.
  const editing = row(
    '<div class="msg-user"><div class="user-pill"><form class="bubble"><textarea>draft</textarea></form></div></div>',
  );
  expect(rowText(editing).text).toBe("");
  expect(rowText(row('<div class="msg-note">Using Codex</div>')).text).toBe(
    "Using Codex",
  );
});

it("finds every match as a Range over the drawn text, across elements", () => {
  const ranges = rangesIn(answer(), "bug");
  expect(ranges.map(String)).toEqual(["Bug", "bug"]);
  expect(rangesIn(answer(), "the bug").map(String)).toEqual(["the Bug"]);
  // Collapsed spaces still map back to the text as written.
  expect(rangesIn(answer(), "fixed the").map(String)).toEqual(["Fixed  the"]);
  expect(rangesIn(answer(), "")).toEqual([]);
  expect(rangesIn(answer(), "copy")).toEqual([]);
});

class FakeHighlight extends Set<Range> {
  priority = 0;
  constructor(...ranges: Range[]) {
    super(ranges);
  }
}

it("paints matches with the highlight API where it exists", () => {
  expect(canHighlight()).toBe(false);
  const [first, second] = rangesIn(answer(), "bug");
  expect(paintMatches([first], second)).toBe(false);

  const registry = new Map<string, FakeHighlight>();
  vi.stubGlobal("CSS", { highlights: registry });
  vi.stubGlobal("Highlight", FakeHighlight);
  expect(canHighlight()).toBe(true);
  expect(paintMatches([first], second)).toBe(true);
  expect([...registry.get(HIGHLIGHT_ALL)!]).toEqual([first]);
  expect([...registry.get(HIGHLIGHT_CURRENT)!]).toEqual([second]);
  expect(registry.get(HIGHLIGHT_CURRENT)!.priority).toBe(1);
  paintMatches([first, second], null);
  expect(registry.has(HIGHLIGHT_CURRENT)).toBe(false);
  clearMatches(document.body);
  expect(registry.size).toBe(0);
});

it("marks one row as the current match's", () => {
  document.body.innerHTML =
    '<div id="stream"><div id="a" data-find-row="a"></div><div id="b" data-find-row="b"></div></div>';
  const stream = document.getElementById("stream")!;
  const a = document.getElementById("a")!;
  const b = document.getElementById("b")!;
  markRow(stream, a, "row");
  expect(a.getAttribute(FIND_CURRENT_ATTR)).toBe("row");
  markRow(stream, b, "text");
  expect(a.hasAttribute(FIND_CURRENT_ATTR)).toBe(false);
  expect(b.getAttribute(FIND_CURRENT_ATTR)).toBe("text");
  clearMatches(stream);
  expect(b.hasAttribute(FIND_CURRENT_ATTR)).toBe(false);
});

function box(top: number, height: number) {
  return { top, bottom: top + height, height } as DOMRect;
}

it("scrolls a match to the middle only when it is out of view", () => {
  const stream = document.createElement("div");
  const target = document.createElement("div");
  stream.getBoundingClientRect = () => box(100, 600);
  Object.defineProperty(stream, "scrollTop", { value: 1000 });
  const scrollTo = vi.fn();
  stream.scrollTo = scrollTo as unknown as typeof stream.scrollTo;

  target.getBoundingClientRect = () => box(300, 40);
  expect(scrollToTarget(stream, target, true)).toBe(false);
  expect(scrollTo).not.toHaveBeenCalled();

  target.getBoundingClientRect = () => box(1500, 40);
  expect(scrollToTarget(stream, target, true)).toBe(true);
  expect(scrollTo).toHaveBeenLastCalledWith({
    top: 1000 + 1500 - 100 - 280,
    behavior: "smooth",
  });
  // A row taller than the view shows from its top.
  target.getBoundingClientRect = () => box(-2000, 900);
  scrollToTarget(stream, target, false);
  expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: "auto" });
});

it("does not scroll smoothly when reduced motion is asked for", () => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
    })),
  );
  expect(smoothScrolling()).toBe(false);
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false })),
  );
  expect(smoothScrolling()).toBe(true);
});
