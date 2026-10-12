import { describe, expect, it } from "vitest";
import { fuzzyMatch, fuzzyRank, matchSegments } from "./fuzzy";

const labels = (hits: { item: string }[]) => hits.map((hit) => hit.item);

describe("fuzzyMatch", () => {
  it("finds the query's letters in order, across words", () => {
    expect(fuzzyMatch("rev ch", "Review changes")?.indices).toEqual([
      0, 1, 2, 7, 8,
    ]);
    expect(fuzzyMatch("cmp", "Compare models on this task")?.indices).toEqual([
      0, 2, 3,
    ]);
  });

  it("ignores case, accents and spaces in the query", () => {
    expect(fuzzyMatch("REVIEW", "review changes")).not.toBeNull();
    expect(fuzzyMatch("resume", "Résumé the task")).not.toBeNull();
    expect(fuzzyMatch("ÉTÉ", "ete")).not.toBeNull();
    expect(fuzzyMatch("review changes", "Reviewchanges")).not.toBeNull();
  });

  it("does not match letters out of order or missing", () => {
    expect(fuzzyMatch("chrev", "Review changes")).toBeNull();
    expect(fuzzyMatch("xyz", "Review changes")).toBeNull();
    expect(fuzzyMatch("settingsx", "Settings")).toBeNull();
  });

  it("matches everything, unscored, for an empty query", () => {
    expect(fuzzyMatch("", "Anything")).toEqual({ score: 0, indices: [] });
    expect(fuzzyMatch("   ", "Anything")).toEqual({ score: 0, indices: [] });
  });

  it("prefers a word start, including a case change, over an earlier mid-word letter", () => {
    expect(fuzzyMatch("pr", "openProject")?.indices).toEqual([4, 5]);
    expect(fuzzyMatch("t", "Get the tests")?.indices).toEqual([4]);
  });

  it("prefers letters that run together over scattered ones", () => {
    expect(fuzzyMatch("ana", "banana")?.indices).toEqual([1, 2, 3]);
  });

  it("counts characters as code points", () => {
    expect(fuzzyMatch("b", "😀 b")?.indices).toEqual([2]);
  });
});

describe("fuzzyRank", () => {
  it("ranks word starts, runs and prefixes first", () => {
    expect(
      labels(fuzzyRank(["Determine", "Open a terminal"], "term", String)),
    ).toEqual(["Open a terminal", "Determine"]);
    expect(
      labels(
        fuzzyRank(["Background processes", "Browse files"], "bro", String),
      ),
    ).toEqual(["Browse files", "Background processes"]);
    expect(
      labels(fuzzyRank(["Toggle settings", "Settings"], "set", String)),
    ).toEqual(["Settings", "Toggle settings"]);
  });

  it("drops items that do not match and keeps the given order on ties", () => {
    const items = [
      "Commit, push and open a pull request",
      "Compare models on this task",
      "Comparisons in this project",
      "Browse files",
    ];
    expect(labels(fuzzyRank(items, "cmp", String))).toEqual([
      "Compare models on this task",
      "Comparisons in this project",
      "Commit, push and open a pull request",
    ]);
    expect(labels(fuzzyRank([items[2], items[1]], "cmp", String))).toEqual([
      items[2],
      items[1],
    ]);
  });

  it("keeps every item, in order, for an empty query", () => {
    expect(labels(fuzzyRank(["b", "a"], "", String))).toEqual(["b", "a"]);
  });
});

describe("matchSegments", () => {
  it("splits text into matched and unmatched runs without changing it", () => {
    const segments = matchSegments("Review changes", [0, 1, 2, 7, 8]);
    expect(segments).toEqual([
      { text: "Rev", match: true },
      { text: "iew ", match: false },
      { text: "ch", match: true },
      { text: "anges", match: false },
    ]);
    expect(segments.map((s) => s.text).join("")).toBe("Review changes");
  });

  it("uses the same positions as the matcher", () => {
    const text = "😀 b";
    expect(matchSegments(text, fuzzyMatch("b", text)!.indices)).toEqual([
      { text: "😀 ", match: false },
      { text: "b", match: true },
    ]);
  });
});
