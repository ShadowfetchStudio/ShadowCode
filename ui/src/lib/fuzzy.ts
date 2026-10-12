/** Fuzzy matching for the command palette. The query's letters must appear
 * in the text in order, though not side by side, ignoring case, accents and
 * spaces, so "rev ch" finds "Review changes" and "cmp" finds "Compare models
 * on this task". Letters that start words, run together or begin the text
 * score higher, so the match a person meant ranks first. */

export type FuzzyMatch = {
  score: number;
  /** Positions of the matched characters (code points, as `Array.from`
   * splits the text), ascending. */
  indices: number[];
};

// Points per matched letter, the bonuses that make one alignment better
// than another, and the penalties for letters skipped between matches.
const SCORE_MATCH = 16;
const BONUS_BOUNDARY = 10;
const BONUS_PREFIX = 8;
const BONUS_CONSECUTIVE = 8;
const PENALTY_GAP_START = 3;
const PENALTY_GAP_EXTENSION = 1;
// A light preference for earlier matches: it breaks ties without
// outweighing a word start further along.
const PENALTY_LEADING = 0.5;
const MAX_LEADING_PENALTY = 5;

const WORD = /[\p{L}\p{N}]/u;
const UPPER = /\p{Lu}/u;
const LOWER = /\p{Ll}/u;
const MARKS = /\p{M}/gu;

/** One character, lower case and without accents ("É" → "e"). */
function fold(ch: string) {
  if (ch < "\u0080") return ch.toLowerCase();
  return ch.normalize("NFD").replace(MARKS, "").toLowerCase();
}

/** A word starts after a space or punctuation, or at a lower→upper case
 * change ("openProject"). */
function startsWord(chars: string[], i: number) {
  if (!WORD.test(chars[i])) return false;
  if (i === 0 || !WORD.test(chars[i - 1])) return true;
  return LOWER.test(chars[i - 1]) && UPPER.test(chars[i]);
}

/** The best way `query` matches `text`, or null when it does not. An empty
 * query matches everything with no score. */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const needle = Array.from(query.replace(/\s+/g, ""))
    .map(fold)
    .filter(Boolean);
  const m = needle.length;
  if (!m) return { score: 0, indices: [] };
  const chars = Array.from(text);
  const n = chars.length;
  if (m > n) return null;
  const hay = chars.map(fold);

  // Most texts do not match at all: a quick in-order scan rules them out
  // before the full search.
  for (let i = 0, j = 0; j < m; i++) {
    if (i === n) return null;
    if (hay[i] === needle[j]) j++;
  }

  const bonus = chars.map(
    (_, i) =>
      (i === 0 ? BONUS_PREFIX : 0) +
      (startsWord(chars, i) ? BONUS_BOUNDARY : 0),
  );
  // score[j*n + i]: the best score for the query's first j+1 letters with
  // letter j matched at text position i; from[…]: where letter j-1 was.
  const score = new Float64Array(m * n).fill(-Infinity);
  const from = new Int32Array(m * n).fill(-1);
  for (let j = 0; j < m; j++) {
    const row = j * n;
    const prev = row - n;
    // The best earlier match at least two positions back (a gap), with the
    // gap's per-letter penalty folded in so one running maximum serves
    // every position.
    let gapBest = -Infinity;
    let gapAt = -1;
    for (let i = j; i < n; i++) {
      if (j > 0 && i >= 2) {
        const k = i - 2;
        const candidate = score[prev + k] + PENALTY_GAP_EXTENSION * k;
        // On a tie the later start leaves the shorter gap.
        if (candidate >= gapBest && score[prev + k] > -Infinity) {
          gapBest = candidate;
          gapAt = k;
        }
      }
      if (hay[i] !== needle[j]) continue;
      const own = SCORE_MATCH + bonus[i];
      if (j === 0) {
        score[i] = own - Math.min(i * PENALTY_LEADING, MAX_LEADING_PENALTY);
        continue;
      }
      let best = -Infinity;
      let at = -1;
      if (score[prev + i - 1] > -Infinity) {
        best = score[prev + i - 1] + BONUS_CONSECUTIVE;
        at = i - 1;
      }
      if (gapAt >= 0) {
        const gap =
          gapBest - PENALTY_GAP_START - PENALTY_GAP_EXTENSION * (i - 2);
        if (gap > best) {
          best = gap;
          at = gapAt;
        }
      }
      if (at < 0) continue;
      score[row + i] = own + best;
      from[row + i] = at;
    }
  }

  const last = (m - 1) * n;
  let end = -1;
  for (let i = m - 1; i < n; i++)
    if (
      score[last + i] > -Infinity &&
      (end < 0 || score[last + i] > score[last + end])
    )
      end = i;
  if (end < 0) return null;
  const indices: number[] = new Array(m);
  for (let j = m - 1, i = end; j >= 0; j--) {
    indices[j] = i;
    i = from[j * n + i];
  }
  return { score: score[last + end], indices };
}

/** The items that match `query`, best first; equal scores keep the items'
 * own order. */
export function fuzzyRank<T>(
  items: readonly T[],
  query: string,
  text: (item: T) => string,
): (FuzzyMatch & { item: T })[] {
  const hits: (FuzzyMatch & { item: T })[] = [];
  for (const item of items) {
    const match = fuzzyMatch(query, text(item));
    if (match) hits.push({ item, ...match });
  }
  // Array sort is stable, so ties stay in the given order.
  return hits.sort((a, b) => b.score - a.score);
}

/** `text` split into runs of matched and unmatched characters, for showing
 * the matched ones emphasised without changing the text itself. */
export function matchSegments(
  text: string,
  indices: readonly number[],
): { text: string; match: boolean }[] {
  const marked = new Set(indices);
  const segments: { text: string; match: boolean }[] = [];
  Array.from(text).forEach((ch, i) => {
    const match = marked.has(i);
    const last = segments.at(-1);
    if (last && last.match === match) last.text += ch;
    else segments.push({ text: ch, match });
  });
  return segments;
}
