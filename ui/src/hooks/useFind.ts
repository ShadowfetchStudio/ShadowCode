import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { api, type HistoryPage } from "../api";
import type { ChatItem } from "../components/cards";
import { replay } from "../lib/transcript";
import { readableError } from "../lib/transport";
import {
  LIVE_PAGE,
  combineHits,
  findDocs,
  findLabel,
  findNeedle,
  firstMatch,
  hitsIn,
  matchAt,
  matchIndex,
  stepIndex,
  type FindDoc,
  type FindMatch,
} from "../lib/find";
import {
  FIND_ROW_ATTR,
  clearMatches,
  markRow,
  paintMatches,
  rangesIn,
  revealTarget,
  scrollToTarget,
  smoothScrolling,
} from "../lib/findHighlight";

/** Typing settles this long before the conversation is searched. */
const TYPING_MS = 120;
/** A streamed answer is searched again at most this often. */
const STREAM_MS = 300;
/** Drawn rows are highlighted again this long after they change. */
const PAINT_MS = 80;
/** Highlights drawn at once; the current match always is. */
const MAX_PAINTED = 2000;
/** Late layout (an answer's Markdown parsed off the main thread) can move a
 * match just shown; it is brought back into view for this long, once a
 * smooth scroll has had time to arrive. */
const SETTLE_MS = 1000;
const SMOOTH_MS = 450;

/** A saved history page as find reads it, and how to open it: `before` and
 * `newer` as useConversation's paging records them. */
type SavedPage = {
  first: number;
  before: number;
  newer: number[];
  docs: FindDoc[];
};
type Scan = {
  key: string;
  pages: SavedPage[];
  next: { before: number; newer: number[] } | null;
  error: string;
};

/** The conversation's saved-history paging (from useConversation). */
export type FindHistory = {
  viewing: boolean;
  firstCursor: number;
  base: { first_cursor: number; has_older: boolean } | null;
  latest: () => void;
  show: (before: number, newer: number[]) => Promise<void>;
};

const NO_PAGES: SavedPage[] = [];

const scanFor = (key: string, base: FindHistory["base"]): Scan => ({
  key,
  pages: [],
  next:
    base?.has_older && base.first_cursor > 0
      ? { before: base.first_cursor, newer: [0] }
      : null,
  error: "",
});

/** `value` while `active`, updated at most every `ms` (a streamed answer
 * changes many times a second); the latest value at once when it starts. */
function useThrottled<T>(value: T, ms: number, active: boolean): T {
  const [held, setHeld] = useState<{ value: T } | null>(null);
  const last = useRef(0);
  useEffect(() => {
    if (!active) {
      setHeld(null);
      return;
    }
    const apply = () => {
      last.current = Date.now();
      setHeld({ value });
    };
    const wait = last.current + ms - Date.now();
    if (wait <= 0) {
      apply();
      return;
    }
    const timer = setTimeout(apply, wait);
    return () => clearTimeout(timer);
  }, [value, ms, active]);
  return active && held ? held.value : value;
}

/** Find in conversation: matches across the whole conversation (the latest
 * messages and every saved page, read page by page in the background), the
 * current match, and bringing it into view: opening its page, rendering
 * its row and scrolling to it with every drawn match highlighted. */
export function useFind({
  open: requested,
  hidden,
  sessionId,
  liveItems,
  liveTaskId,
  queuedTaskIds,
  history,
  streamRef,
  release,
  onClose,
}: {
  open: boolean;
  /** Review or Compare shows in the conversation's place. */
  hidden: boolean;
  sessionId: string;
  /** The latest messages, also while a saved page is shown. */
  liveItems: ChatItem[];
  liveTaskId?: string;
  /** Queued follow-ups show in the queue, not the transcript. */
  queuedTaskIds: ReadonlySet<string>;
  history: FindHistory;
  streamRef: RefObject<HTMLDivElement | null>;
  /** Stop following new content (the reader is looking at a match). */
  release: () => void;
  onClose: () => void;
}) {
  const open = requested && !hidden;
  // Review and Compare take the conversation's place; find closes with it.
  useEffect(() => {
    if (requested && hidden) onClose();
  }, [requested, hidden, onClose]);
  const [query, setQuery] = useState("");
  const [needle, setNeedle] = useState("");
  useEffect(() => {
    const next = open ? findNeedle(query) : "";
    const timer = setTimeout(() => setNeedle(next), next ? TYPING_MS : 0);
    return () => clearTimeout(timer);
  }, [query, open]);
  const active = open && Boolean(needle);
  const [current, setCurrent] = useState<{
    needle: string;
    match: FindMatch;
  } | null>(null);

  // Another conversation closes find and forgets the query.
  const shownSession = useRef(sessionId);
  useEffect(() => {
    if (shownSession.current === sessionId) return;
    shownSession.current = sessionId;
    setQuery("");
    setNeedle("");
    setCurrent(null);
    if (requested) onClose();
  }, [sessionId, requested, onClose]);

  // The latest messages, searched again at most every STREAM_MS.
  const live = useThrottled(liveItems, STREAM_MS, active);
  const skip = useCallback(
    (item: ChatItem) =>
      item.kind === "user" &&
      Boolean(item.taskId) &&
      item.taskId !== liveTaskId &&
      queuedTaskIds.has(item.taskId!),
    [liveTaskId, queuedTaskIds],
  );
  const liveDocs = useMemo(
    () => (active ? findDocs(live, skip) : []),
    [active, live, skip],
  );

  // Saved pages, newest first, read one at a time while find has a query.
  const base = history.base;
  const scanKey = `${sessionId}:${base?.first_cursor ?? 0}:${base?.has_older ?? false}`;
  const [scan, setScan] = useState<Scan>(() => scanFor("", null));
  useEffect(() => {
    if (!active || !sessionId) return;
    if (scan.key !== scanKey) {
      setScan(scanFor(scanKey, base));
      return;
    }
    const next = scan.next;
    if (!next) return;
    let cancelled = false;
    api.historyPage(sessionId, next.before).then(
      (page: HistoryPage) => {
        if (cancelled) return;
        const first = page.first_cursor;
        setScan((current) =>
          current !== scan
            ? current
            : {
                ...current,
                pages: first
                  ? [
                      ...current.pages,
                      {
                        first,
                        before: next.before,
                        newer: next.newer,
                        docs: findDocs(replay(page.events).items),
                      },
                    ]
                  : current.pages,
                next:
                  page.has_older && first > 0 && first < next.before
                    ? { before: first, newer: [...next.newer, next.before] }
                    : null,
              },
        );
      },
      (error: unknown) => {
        if (cancelled) return;
        setScan((current) =>
          current !== scan
            ? current
            : { ...current, next: null, error: readableError(error) },
        );
      },
    );
    return () => {
      cancelled = true;
    };
    // `base` is part of scanKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, sessionId, scanKey, scan]);
  const pages = scan.key === scanKey ? scan.pages : NO_PAGES;
  const searching = active && scan.key === scanKey && Boolean(scan.next);

  // Each saved page is matched once per query.
  const pageHits = useRef(
    new WeakMap<
      SavedPage,
      { needle: string; hits: ReturnType<typeof hitsIn> }
    >(),
  );
  const results = useMemo(() => {
    const saved = pages
      .slice()
      .reverse()
      .map((page) => {
        let cached = pageHits.current.get(page);
        if (cached?.needle !== needle) {
          cached = { needle, hits: hitsIn(page.docs, needle) };
          pageHits.current.set(page, cached);
        }
        return { page: page.first, hits: cached.hits };
      });
    return combineHits([
      ...saved,
      { page: LIVE_PAGE, hits: hitsIn(liveDocs, needle) },
    ]);
  }, [pages, liveDocs, needle]);

  const visible = history.viewing ? history.firstCursor : LIVE_PAGE;
  const match = active && current?.needle === needle ? current.match : null;
  const index = matchIndex(results, match);
  /** A match asked for and not yet scrolled to (or still settling). */
  const pending = useRef<{
    match: FindMatch;
    shown: number;
    calm: number;
  } | null>(null);

  const go = useCallback(
    (next: FindMatch) => {
      setCurrent({ needle, match: next });
      pending.current = { match: next, shown: 0, calm: 0 };
      if (next.page === LIVE_PAGE) {
        if (history.viewing) history.latest();
      } else if (!(history.viewing && history.firstCursor === next.page)) {
        const page = pages.find((saved) => saved.first === next.page);
        if (page) void history.show(page.before, page.newer);
      }
    },
    [needle, history, pages],
  );

  // A new query starts on the latest match where the reader is (once one
  // is found, and once the saved page being read has been searched); a
  // match that went away (an answer rewritten) is replaced.
  const visibleRead =
    visible === LIVE_PAGE ||
    !searching ||
    pages.some((page) => page.first === visible);
  useEffect(() => {
    if (!active || index >= 0 || !results.total || !visibleRead) return;
    const first = firstMatch(results, visible);
    if (first) go(first);
  }, [active, index, results, visible, visibleRead, go]);

  const step = useCallback(
    (by: 1 | -1) => {
      const next = matchAt(results, stepIndex(index, results.total, by));
      if (next) go(next);
    },
    [results, index, go],
  );

  // Highlights follow the drawn rows: every match in them, the current one
  // distinct; the current row is marked where text cannot be highlighted.
  const rowsOnPage = useMemo(() => {
    const keys = new Set<string>();
    for (const hit of results.hits) if (hit.page === visible) keys.add(hit.key);
    return keys;
  }, [results, visible]);
  const paint = useRef(() => {});
  paint.current = () => {
    const stream = streamRef.current;
    if (!stream) return;
    if (!active) {
      clearMatches(stream);
      return;
    }
    const want = match && match.page === visible ? match : null;
    const all: Range[] = [];
    let row: HTMLElement | null = null;
    let range: Range | null = null;
    for (const each of stream.querySelectorAll<HTMLElement>(
      `[${FIND_ROW_ATTR}]`,
    )) {
      const key = each.getAttribute(FIND_ROW_ATTR) || "";
      if (!rowsOnPage.has(key)) continue;
      const ranges = rangesIn(each, needle);
      if (want?.key === key) {
        row = each;
        range = ranges[want.occurrence] || null;
      }
      for (const found of ranges)
        if (found !== range && all.length < MAX_PAINTED) all.push(found);
    }
    const painted = paintMatches(all, range);
    markRow(stream, row, painted && range ? "text" : "row");
    const asked = pending.current;
    if (!asked || !row || !want || asked.match !== want) return;
    const target = revealTarget(row, range);
    // Scrolling away from the bottom stops the conversation following new
    // output (as scrolling up by hand does).
    const now = Date.now();
    if (!asked.shown) {
      const smooth = smoothScrolling();
      if (scrollToTarget(stream, target, smooth)) release();
      asked.shown = now;
      asked.calm = now + (smooth ? SMOOTH_MS : 0);
    } else if (now - asked.shown > SETTLE_MS) pending.current = null;
    else if (now >= asked.calm && scrollToTarget(stream, target, false))
      release();
  };
  useEffect(() => {
    paint.current();
  }, [active, results, match, visible, needle]);
  useEffect(() => {
    const stream = streamRef.current;
    if (!active || !stream) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver(() => {
      timer ??= setTimeout(() => {
        timer = undefined;
        paint.current();
      }, PAINT_MS);
    });
    observer.observe(stream, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => {
      observer.disconnect();
      clearTimeout(timer);
      clearMatches(stream);
    };
  }, [active, streamRef]);

  const total = results.total;
  return {
    query,
    setQuery,
    /** "3 of 12", "No matches", or nothing before a query. */
    label: !needle
      ? ""
      : !total && searching
        ? "Searching…"
        : findLabel(index, total),
    total,
    searching,
    /** Saved pages could not be read; matches there are missing. */
    error: active && scan.key === scanKey ? scan.error : "",
    next: () => step(1),
    previous: () => step(-1),
    /** The row to keep rendered on the page being read. */
    reveal: match && match.page === visible ? match.key : undefined,
  };
}
