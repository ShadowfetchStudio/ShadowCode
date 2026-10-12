import { expect, it } from "vitest";
import type { ChatItem } from "../components/cards";
import {
  LIVE_PAGE,
  combineHits,
  countIn,
  findDocs,
  findLabel,
  findNeedle,
  firstMatch,
  foldCase,
  hitsIn,
  itemText,
  markdownText,
  matchAt,
  matchIndex,
  offsetsIn,
  searchText,
  stepIndex,
} from "./find";

it("folds case without moving any character", () => {
  expect(foldCase("Hello WORLD")).toBe("hello world");
  // "İ" lower-cases to two characters; it stays as it is.
  const text = "İstanbul Straße";
  expect(foldCase(text)).toHaveLength(text.length);
  expect(foldCase(text)).toBe("İstanbul straße");
});

it("matches queries trimmed, with spaces collapsed, ignoring case", () => {
  expect(findNeedle("  Fix   the\tBug ")).toBe("fix the bug");
  expect(findNeedle("   ")).toBe("");
});

it("reads an answer's Markdown as it shows on screen", () => {
  expect(
    markdownText(
      "## Plan\n\nRecorded answer with **emphasis**, `code`, and [a link](https://x.dev).",
    ),
  ).toBe("Plan\n\nRecorded answer with emphasis, code, and a link.");
  expect(markdownText("- [x] done\n1. first\n> quoted _note_")).toBe(
    "done\nfirst\nquoted note",
  );
  // Code keeps its characters; snake_case and lone stars are not emphasis.
  expect(
    markdownText(
      "```ts\nconst a = b ** 2; // **x**\n```\nsnake_case_name, 2 * 3",
    ),
  ).toBe("const a = b ** 2; // **x**\nsnake_case_name, 2 * 3");
  expect(markdownText("Run `` a `b` c `` now")).toBe("Run a `b` c now");
  expect(markdownText("| a | b |\n|---|:-:|\n| 1 | 2 |")).toBe(
    "  a   b  \n\n  1   2  ",
  );
  expect(markdownText("![diagram](x.png) and \\*literal\\*")).toBe(
    "[Image: diagram] and *literal*",
  );
  expect(markdownText("~~old~~ __new__ ***both***")).toBe("old new both");
});

it("searches prompts, answers and notes, not cards or tool steps", () => {
  const items: ChatItem[] = [
    { kind: "user", text: "Fix the **bug**", key: "u" },
    { kind: "agent", text: "Fixed the **bug**", key: "a" },
    { kind: "note", text: "Using Codex", key: "n" },
    { kind: "tool", tool: "read_file", text: "bug.ts", key: "t" },
    { kind: "summary", taskId: "t1", text: "bug" },
  ];
  expect(items.map(itemText)).toEqual([
    "Fix the **bug**",
    "Fixed the bug",
    "Using Codex",
    null,
    null,
  ]);
  // Rows are keyed as TranscriptRows keys them; skipped rows are left out.
  expect(findDocs(items, (item) => item.kind === "note")).toEqual([
    { key: "u", text: "fix the **bug**" },
    { key: "a", text: "fixed the bug" },
  ]);
  expect(findDocs([{ kind: "note", text: "A\n\n  B" }])).toEqual([
    { key: "i:0", text: "a b" },
  ]);
});

it("works out an item's text once", () => {
  const item: ChatItem = { kind: "agent", text: "**Once**", key: "a" };
  const first = searchText(item);
  expect(first).toBe("once");
  item.text = "changed in place";
  expect(searchText(item)).toBe(first);
  expect(searchText({ ...item })).toBe("changed in place");
});

it("counts matches without overlap, as browsers do", () => {
  expect(countIn("aaaa", "aa")).toBe(2);
  expect(countIn("abc", "")).toBe(0);
  expect(offsetsIn("a b a b a", "a b")).toEqual([0, 4]);
  expect(
    hitsIn(
      [
        { key: "x", text: "bug bug" },
        { key: "y", text: "nothing" },
        { key: "z", text: "a bug" },
      ],
      "bug",
    ),
  ).toEqual([
    { key: "x", count: 2 },
    { key: "z", count: 1 },
  ]);
});

const results = () =>
  combineHits([
    // An older saved page, then the latest messages.
    {
      page: 40,
      hits: [
        { key: "p1", count: 2 },
        { key: "p2", count: 1 },
      ],
    },
    { page: LIVE_PAGE, hits: [{ key: "l1", count: 3 }] },
  ]);

it("numbers matches oldest first across pages", () => {
  const all = results();
  expect(all.total).toBe(6);
  const listed = Array.from({ length: all.total }, (_, i) => matchAt(all, i));
  expect(listed).toEqual([
    { page: 40, key: "p1", occurrence: 0 },
    { page: 40, key: "p1", occurrence: 1 },
    { page: 40, key: "p2", occurrence: 0 },
    { page: 0, key: "l1", occurrence: 0 },
    { page: 0, key: "l1", occurrence: 1 },
    { page: 0, key: "l1", occurrence: 2 },
  ]);
  listed.forEach((match, i) => expect(matchIndex(all, match)).toBe(i));
  expect(matchAt(all, 6)).toBeNull();
  expect(matchAt(all, -1)).toBeNull();
  // A match the list no longer has.
  expect(matchIndex(all, { page: 0, key: "l1", occurrence: 3 })).toBe(-1);
  expect(matchIndex(all, { page: 40, key: "gone", occurrence: 0 })).toBe(-1);
  expect(matchIndex(all, null)).toBe(-1);
});

it("starts on the latest match of the page being read", () => {
  const all = results();
  expect(firstMatch(all, LIVE_PAGE)).toEqual({
    page: 0,
    key: "l1",
    occurrence: 2,
  });
  expect(firstMatch(all, 40)).toEqual({ page: 40, key: "p2", occurrence: 0 });
  // Nothing on this page: the latest in the conversation.
  expect(firstMatch(all, 99)).toEqual({ page: 0, key: "l1", occurrence: 2 });
  expect(firstMatch(combineHits([]), 0)).toBeNull();
});

it("steps through matches, wrapping at both ends", () => {
  expect(stepIndex(0, 3, 1)).toBe(1);
  expect(stepIndex(2, 3, 1)).toBe(0);
  expect(stepIndex(0, 3, -1)).toBe(2);
  expect(stepIndex(-1, 3, 1)).toBe(0);
  expect(stepIndex(-1, 3, -1)).toBe(2);
  expect(stepIndex(0, 0, 1)).toBe(-1);
});

it("says where you are in the matches", () => {
  expect(findLabel(2, 12)).toBe("3 of 12");
  expect(findLabel(0, 0)).toBe("No matches");
  expect(findLabel(-1, 1)).toBe("1 match");
  expect(findLabel(1233, 10000)).toBe("1,234 of 10,000");
});
