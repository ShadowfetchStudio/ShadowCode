import type { ChatItem } from "../components/cards";

/** Find in conversation: what it reads and how it counts. Pure, so the
 * window (useFind) and the tests agree on every number. Text is compared
 * with whitespace collapsed and case folded, the same way on both sides:
 * transcript items here, rendered rows in findHighlight. */

/** The conversation's live window. Saved history pages use their first
 * event cursor, which is always positive. */
export const LIVE_PAGE = 0;

/** Lower case that keeps every character at its index, so offsets in the
 * folded text are offsets in the original (a few characters, like "İ",
 * lower-case to two). */
export function foldCase(text: string): string {
  const lower = text.toLowerCase();
  if (lower.length === text.length) return lower;
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const folded = text[i].toLowerCase();
    out += folded.length === 1 ? folded : text[i];
  }
  return out;
}

/** The query as matched: trimmed, whitespace collapsed, case folded. Empty
 * means there is nothing to find. */
export function findNeedle(query: string): string {
  return foldCase(query.trim().replace(/\s+/g, " "));
}

const CODE_SPAN = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g;

/** Inline Markdown outside code spans, as it reads on screen. */
function inlineText(text: string): string {
  // Escaped punctuation is literal: set it aside (as private-use
  // characters) so no rule below reads it as markup.
  let out = text
    .replace(/\\([\\`*_{}[\]()#+\-.!|~<>])/g, (_, char: string) =>
      String.fromCharCode(0xe000 + char.charCodeAt(0)),
    )
    .replace(
      /!\[([^\]]*)\]\([^)]*\)/g,
      (_, alt: string) =>
        // Markdown.tsx shows images as a placeholder.
        `[Image: ${alt || "attachment"}]`,
    )
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<((?:https?|mailto):[^>\s]+)>/g, "$1");
  // Emphasis, innermost last: **strong**, __strong__, ~~strike~~, *em*, _em_
  // (underscores inside words, as in snake_case, are not emphasis).
  for (let pass = 0; pass < 2; pass++)
    out = out
      .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "$1")
      .replace(/(^|[^\w_])__(?=\S)([\s\S]*?\S)__(?![\w_])/g, "$1$2")
      .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "$1")
      .replace(/\*(?=[^\s*])([^*]*?[^\s*])\*/g, "$1")
      .replace(/(^|[^\w_])_(?=[^\s_])([^_]*?[^\s_])_(?![\w_])/g, "$1$2");
  return out.replace(/[\ue000-\ue07f]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xe000),
  );
}

/** One line of Markdown outside a fenced block, without its block markers. */
function lineText(line: string): string {
  if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) return "";
  // A table's delimiter row; its other rows read cell by cell.
  if (/^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(line)) return "";
  let text = line
    .replace(/^\s{0,3}(>\s?)+/, "")
    .replace(/^\s{0,3}#{1,6}(\s+|$)/, "")
    .replace(/\s+#+\s*$/, "")
    .replace(/^\s*([-*+]|\d{1,9}[.)])\s+(\[[ xX]\]\s+)?/, "");
  if (/^\s*\|/.test(line)) text = text.replace(/\|/g, " ");
  let out = "";
  let last = 0;
  for (const match of text.matchAll(CODE_SPAN)) {
    out += inlineText(text.slice(last, match.index));
    // One space just inside both backtick runs is padding, not content.
    const code = match[2];
    out += /^ [\s\S]* $/.test(code) && code.trim() ? code.slice(1, -1) : code;
    last = match.index + match[0].length;
  }
  return out + inlineText(text.slice(last));
}

/** An answer's Markdown as it reads on screen, near enough to count what
 * find would highlight: block and inline markup removed, code kept as is. */
export function markdownText(source: string): string {
  const lines: string[] = [];
  let fence = "";
  for (const line of source.split("\n")) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/)?.[1];
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length)
        fence = "";
      else lines.push(line);
    } else if (marker) fence = marker;
    else lines.push(lineText(line));
  }
  return lines.join("\n");
}

/** The text of an item that find reads: prompts, answers and notes. Cards,
 * tool steps (in collapsed timelines) and summaries are not searched. */
export function itemText(item: ChatItem): string | null {
  if (item.kind === "user" || item.kind === "note") return item.text;
  if (item.kind === "agent") return markdownText(item.text);
  return null;
}

/** Items are replaced, never changed, when an event updates them, so their
 * searchable text is worked out once per item. */
const searchable = new WeakMap<ChatItem, string | null>();

/** An item's text as find compares it, or null when it is not searched. */
export function searchText(item: ChatItem): string | null {
  let text = searchable.get(item);
  if (text === undefined) {
    const raw = itemText(item);
    text = raw === null ? null : foldCase(raw.replace(/\s+/g, " "));
    searchable.set(item, text);
  }
  return text;
}

/** One searchable row: its transcript row key and text. */
export type FindDoc = { key: string; text: string };

/** The rows find reads, keyed as TranscriptRows keys them. `skip` leaves out
 * rows that are not drawn (a queued follow-up shows in the queue). */
export function findDocs(
  items: ChatItem[],
  skip?: (item: ChatItem) => boolean,
): FindDoc[] {
  const docs: FindDoc[] = [];
  items.forEach((item, index) => {
    const text = searchText(item);
    if (text && !skip?.(item))
      docs.push({ key: item.key || `i:${index}`, text });
  });
  return docs;
}

/** Occurrences of `needle` in `text`, not overlapping (as browsers count). */
export function countIn(text: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  for (
    let at = text.indexOf(needle);
    at >= 0;
    at = text.indexOf(needle, at + needle.length)
  )
    count++;
  return count;
}

/** Where each occurrence of `needle` starts in `text`. */
export function offsetsIn(text: string, needle: string): number[] {
  const offsets: number[] = [];
  if (!needle) return offsets;
  for (
    let at = text.indexOf(needle);
    at >= 0;
    at = text.indexOf(needle, at + needle.length)
  )
    offsets.push(at);
  return offsets;
}

/** Rows with at least one match, in order, and how many each has. */
export function hitsIn(
  docs: FindDoc[],
  needle: string,
): { key: string; count: number }[] {
  const hits: { key: string; count: number }[] = [];
  if (!needle) return hits;
  for (const doc of docs) {
    const count = countIn(doc.text, needle);
    if (count) hits.push({ key: doc.key, count });
  }
  return hits;
}

/** One match: the page and row it is in, and which of the row's matches. */
export type FindMatch = { page: number; key: string; occurrence: number };

/** Every match of the conversation, oldest first. Rows hold their counts
 * (not one entry per match), so a one-letter query in a long conversation
 * stays small. */
export type FindResults = {
  hits: { page: number; key: string; count: number }[];
  /** The index of each row's first match. */
  starts: number[];
  total: number;
  lookup: Map<string, number>;
};

const hitId = (page: number, key: string) => `${page}\u0000${key}`;

/** One result list from each page's hits, pages given oldest first. */
export function combineHits(
  pages: { page: number; hits: { key: string; count: number }[] }[],
): FindResults {
  const results: FindResults = {
    hits: [],
    starts: [],
    total: 0,
    lookup: new Map(),
  };
  for (const { page, hits } of pages)
    for (const { key, count } of hits) {
      results.lookup.set(hitId(page, key), results.hits.length);
      results.hits.push({ page, key, count });
      results.starts.push(results.total);
      results.total += count;
    }
  return results;
}

/** The match at a position (0-based), or null outside the list. */
export function matchAt(results: FindResults, index: number): FindMatch | null {
  if (index < 0 || index >= results.total) return null;
  let low = 0;
  let high = results.hits.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (results.starts[mid] <= index) low = mid;
    else high = mid - 1;
  }
  const hit = results.hits[low];
  return {
    page: hit.page,
    key: hit.key,
    occurrence: index - results.starts[low],
  };
}

/** A match's position, or -1 when the list no longer has it. */
export function matchIndex(
  results: FindResults,
  match: FindMatch | null,
): number {
  if (!match) return -1;
  const at = results.lookup.get(hitId(match.page, match.key));
  if (at === undefined || match.occurrence >= results.hits[at].count) return -1;
  return results.starts[at] + match.occurrence;
}

/** The match a new query starts on: the latest one on the page being read,
 * else the latest in the conversation. */
export function firstMatch(
  results: FindResults,
  page: number,
): FindMatch | null {
  for (let i = results.hits.length - 1; i >= 0; i--)
    if (results.hits[i].page === page)
      return matchAt(results, results.starts[i] + results.hits[i].count - 1);
  return matchAt(results, results.total - 1);
}

/** The next (1) or previous (-1) position, wrapping at either end. */
export function stepIndex(index: number, total: number, by: 1 | -1): number {
  if (total <= 0) return -1;
  if (index < 0) return by === 1 ? 0 : total - 1;
  return (index + by + total) % total;
}

const count = (n: number) => n.toLocaleString("en-US");

/** "3 of 12", "No matches", or "12 matches" before one is chosen. */
export function findLabel(index: number, total: number): string {
  if (total <= 0) return "No matches";
  if (index < 0) return `${count(total)} ${total === 1 ? "match" : "matches"}`;
  return `${count(index + 1)} of ${count(total)}`;
}
