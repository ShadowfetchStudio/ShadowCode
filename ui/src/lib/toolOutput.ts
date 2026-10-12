/** Characters of a tool's output shown before "Show all". */
export const OUTPUT_PREVIEW_CHARS = 4000;
/** "Show all" keeps the window responsive with huge output: it shows at
 * most the last this many lines... */
export const OUTPUT_MAX_LINES = 2000;
/** ...and at most the last this many characters (one enormous line). Copy
 * always copies the whole output. */
export const OUTPUT_MAX_CHARS = 200_000;

export type OutputView = {
  /** The text to show. */
  text: string;
  /** Lines in the whole output. */
  lines: number;
  /** Longer than the preview, so "Show all" is offered. */
  long: boolean;
  /** What the expanded view leaves out, said plainly. */
  hidden?: string;
};

/** Lines in `text`; a final newline does not start another line. */
export function countLines(text: string): number {
  if (!text) return 0;
  let lines = 1;
  for (let at = text.indexOf("\n"); at >= 0; at = text.indexOf("\n", at + 1))
    lines++;
  return text.endsWith("\n") ? lines - 1 : lines;
}

/** Where the last `count` lines of `text` start. */
function lastLinesStart(text: string, count: number): number {
  let at = text.endsWith("\n") ? text.length - 1 : text.length;
  for (let seen = 0; seen < count; seen++) {
    at = text.lastIndexOf("\n", at - 1);
    if (at < 0) return 0;
  }
  return at + 1;
}

const many = (n: number, one: string, more: string) =>
  `${n.toLocaleString()} ${n === 1 ? one : more}`;

/** "Show all (2,481 lines)", or characters for one long line. */
export function showAllLabel(view: OutputView, length: number): string {
  return `Show all (${
    view.lines > 1
      ? many(view.lines, "line", "lines")
      : many(length, "character", "characters")
  })`;
}

/** What a tool's output shows: its first `OUTPUT_PREVIEW_CHARS` characters,
 * or expanded, all of it up to the last `OUTPUT_MAX_LINES` lines and
 * `OUTPUT_MAX_CHARS` characters (the end of a command's output is where its
 * result usually is). */
export function outputView(text: string, expanded: boolean): OutputView {
  const lines = countLines(text);
  const long = text.length > OUTPUT_PREVIEW_CHARS;
  if (!long) return { text, lines, long };
  if (!expanded)
    return { text: `${text.slice(0, OUTPUT_PREVIEW_CHARS)}\n…`, lines, long };
  let start =
    lines > OUTPUT_MAX_LINES ? lastLinesStart(text, OUTPUT_MAX_LINES) : 0;
  let hidden =
    start > 0
      ? `Showing the last ${OUTPUT_MAX_LINES.toLocaleString()} of ${many(lines, "line", "lines")}.`
      : undefined;
  if (text.length - start > OUTPUT_MAX_CHARS) {
    start = text.length - OUTPUT_MAX_CHARS;
    hidden = `Showing the last ${OUTPUT_MAX_CHARS.toLocaleString()} of ${many(text.length, "character", "characters")}.`;
  }
  return {
    text: start > 0 ? `…\n${text.slice(start)}` : text,
    lines,
    long,
    ...(hidden ? { hidden: `${hidden} Copy includes all of it.` } : {}),
  };
}
