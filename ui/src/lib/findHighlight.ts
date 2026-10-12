import { foldCase, offsetsIn } from "./find";

/** Find in conversation, on screen: the text a transcript row draws, the
 * CSS Custom Highlight API where the webview has it (older WebKitGTK does
 * not), and scrolling a match into view. */

/** TranscriptRows marks each searchable row with its key. */
export const FIND_ROW_ATTR = "data-find-row";
/** The row holding the current match. "text" when the match itself is
 * highlighted, "row" when only the row can be marked (no highlight API, or
 * the drawn text differs from what was counted). */
export const FIND_CURRENT_ATTR = "data-find-current";

export const HIGHLIGHT_ALL = "shadow-find";
export const HIGHLIGHT_CURRENT = "shadow-find-current";

/** Where a row draws the text find reads: an answer's Markdown, a prompt's
 * bubble (not its edit form) and a note. */
const TEXT = ".msg-agent > .markdown, .user-pill > div.bubble, .msg-note";
/** Controls inside that text (a code block's Copy) are not part of it. */
const SKIP = "button, .markdown-preview";
/** Text in different blocks reads as separate words. */
const BLOCK =
  "p, li, pre, td, th, h1, h2, h3, h4, h5, h6, blockquote, div, dd, dt, tr";

/** The characters `\s` matches, so both sides collapse the same spaces. */
function isSpace(code: number): boolean {
  return (
    code === 32 ||
    (code >= 9 && code <= 13) ||
    code === 160 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff
  );
}

/** A row's drawn text as find compares it (whitespace collapsed, blocks
 * apart), with each character's text node (-1 for a gap between blocks) and
 * offset in it. */
export function rowText(row: Element): {
  text: string;
  nodes: Text[];
  node: number[];
  offset: number[];
} {
  const nodes: Text[] = [];
  const node: number[] = [];
  const offset: number[] = [];
  const chars: string[] = [];
  let space = true;
  let block: Element | null = null;
  for (const root of row.querySelectorAll(TEXT)) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let next = walker.nextNode(); next; next = walker.nextNode()) {
      const parent = next.parentElement;
      if (!parent || parent.closest(SKIP)) continue;
      const own = parent.closest(BLOCK);
      if (own !== block) {
        if (!space) {
          chars.push(" ");
          node.push(-1);
          offset.push(0);
          space = true;
        }
        block = own;
      }
      const data = (next as Text).data;
      const index = nodes.push(next as Text) - 1;
      for (let i = 0; i < data.length; i++) {
        if (isSpace(data.charCodeAt(i))) {
          if (space) continue;
          chars.push(" ");
          space = true;
        } else {
          chars.push(data[i]);
          space = false;
        }
        node.push(index);
        offset.push(i);
      }
    }
  }
  return { text: chars.join(""), nodes, node, offset };
}

/** A Range for each match of `needle` (from findNeedle) in a row's text. */
export function rangesIn(row: Element, needle: string): Range[] {
  if (!needle) return [];
  const { text, nodes, node, offset } = rowText(row);
  // The needle neither starts nor ends with a space, so both ends of a
  // match are characters of a text node.
  return offsetsIn(foldCase(text), needle).map((start) => {
    const end = start + needle.length - 1;
    const range = document.createRange();
    range.setStart(nodes[node[start]], offset[start]);
    range.setEnd(nodes[node[end]], offset[end] + 1);
    return range;
  });
}

/** The CSS Custom Highlight API (Chromium, newer WebKitGTK). */
export function canHighlight(): boolean {
  return (
    typeof CSS !== "undefined" &&
    "highlights" in CSS &&
    typeof Highlight === "function"
  );
}

/** Highlights every match and the current one. False when the webview
 * cannot, so the caller marks the row instead. */
export function paintMatches(all: Range[], current: Range | null): boolean {
  if (!canHighlight()) return false;
  const every = new Highlight();
  for (const range of all) every.add(range);
  CSS.highlights.set(HIGHLIGHT_ALL, every);
  if (current) {
    const highlight = new Highlight(current);
    highlight.priority = 1;
    CSS.highlights.set(HIGHLIGHT_CURRENT, highlight);
  } else CSS.highlights.delete(HIGHLIGHT_CURRENT);
  return true;
}

export function clearMatches(root?: Element | null) {
  if (canHighlight()) {
    CSS.highlights.delete(HIGHLIGHT_ALL);
    CSS.highlights.delete(HIGHLIGHT_CURRENT);
  }
  markRow(root, null, "row");
}

/** Marks the current match's row (and unmarks the previous one). */
export function markRow(
  root: Element | null | undefined,
  row: Element | null,
  how: "text" | "row",
) {
  root?.querySelectorAll(`[${FIND_CURRENT_ATTR}]`).forEach((marked) => {
    if (marked !== row) marked.removeAttribute(FIND_CURRENT_ATTR);
  });
  if (row && row.getAttribute(FIND_CURRENT_ATTR) !== how)
    row.setAttribute(FIND_CURRENT_ATTR, how);
}

/** What to scroll to: the match, else its row's first box (rows are
 * `display: contents`, so the wrapper itself has none). */
export function revealTarget(
  row: Element,
  range: Range | null,
): Range | Element {
  return range || row.firstElementChild || row;
}

const MARGIN = 48;

/** The target is inside the scrolled view, clear of its edges. */
export function inView(stream: Element, target: Range | Element): boolean {
  const box = target.getBoundingClientRect();
  const view = stream.getBoundingClientRect();
  return box.top >= view.top + MARGIN && box.bottom <= view.bottom - MARGIN;
}

/** Scrolls the stream so the target sits in the middle (a tall row: its
 * top), only when it is not already in view. */
export function scrollToTarget(
  stream: Element,
  target: Range | Element,
  smooth: boolean,
): boolean {
  if (inView(stream, target)) return false;
  const box = target.getBoundingClientRect();
  const view = stream.getBoundingClientRect();
  const offset =
    box.height > view.height - 2 * MARGIN
      ? MARGIN
      : (view.height - box.height) / 2;
  stream.scrollTo({
    top: Math.max(0, stream.scrollTop + box.top - view.top - offset),
    behavior: smooth ? "smooth" : "auto",
  });
  return true;
}

/** Smooth scrolling unless the system asks for reduced motion. */
export function smoothScrolling(): boolean {
  return !window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
}
