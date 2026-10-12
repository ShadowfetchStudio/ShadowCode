import type { ChatItem } from "../components/cards";

/** A message within this many seconds of the one before it (on the same
 * day) keeps its time quiet: it shows on hover or focus, not all the time. */
export const QUIET_GAP_SECONDS = 5 * 60;

/** An event's `ts` (seconds since the epoch, as the engine records it), or
 * nothing when it is missing or unusable. A message never shows a made-up
 * time. */
export function eventTime(ts: unknown): number | undefined {
  return typeof ts === "number" && Number.isFinite(ts) && ts > 0
    ? ts
    : undefined;
}

export type MessageTimeText = {
  /** What the transcript shows: "14:32", "Yesterday 14:32", "3 Oct, 14:32",
   * or "3 Oct 2025" for another year. */
  label: string;
  /** The full local date and time, for the tooltip. */
  full: string;
  /** Machine-readable, for `<time dateTime>`. */
  iso: string;
};

const startOfDay = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Whole calendar days from `at` to `now` in local time (1 = yesterday).
 * Rounded, so a daylight-saving change does not shift the count. */
function daysBefore(at: Date, now: Date): number {
  return Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000);
}

const clocks = new Map<string, Intl.DateTimeFormatOptions>();

/** Hours and minutes as the locale writes them: "09:05" on a 24-hour clock,
 * "9:05 AM" on a 12-hour one (not "09:05 AM"). */
function clock(locale?: string): Intl.DateTimeFormatOptions {
  const key = locale ?? "";
  let options = clocks.get(key);
  if (!options) {
    const { hourCycle } = new Intl.DateTimeFormat(locale, {
      hour: "numeric",
    }).resolvedOptions();
    options = {
      hour: hourCycle === "h11" || hourCycle === "h12" ? "numeric" : "2-digit",
      minute: "2-digit",
    };
    clocks.set(key, options);
  }
  return options;
}

/** A message's time, worded from `now` in the viewer's locale (`locale` is
 * for tests): the time today, "Yesterday" and the time, the date and time
 * earlier this year, and only the date before that. */
export function messageTime(
  ts: number,
  now: number,
  locale?: string,
): MessageTimeText | null {
  if (!eventTime(ts)) return null;
  const at = new Date(ts * 1000);
  const today = new Date(now * 1000);
  const time = at.toLocaleTimeString(locale, clock(locale));
  const days = daysBefore(at, today);
  const label =
    days === 0
      ? time
      : days === 1
        ? `Yesterday ${time}`
        : at.getFullYear() === today.getFullYear()
          ? at.toLocaleString(locale, {
              day: "numeric",
              month: "short",
              ...clock(locale),
            })
          : at.toLocaleDateString(locale, {
              day: "numeric",
              month: "short",
              year: "numeric",
            });
  return {
    label,
    full: at.toLocaleString(locale, { dateStyle: "full", timeStyle: "short" }),
    iso: at.toISOString(),
  };
}

/** The prompts and answers whose time can stay quiet: less than
 * `QUIET_GAP_SECONDS` after the last time shown, on the same day. A quick
 * exchange shows its time once, and a long run of messages shows it again
 * every few minutes. `items` are the rows in order; other rows (notes,
 * tools, cards) do not interrupt a run. */
export function quietTimes(items: readonly ChatItem[]): Set<ChatItem> {
  const quiet = new Set<ChatItem>();
  let shown: number | undefined;
  for (const item of items) {
    if (item.kind !== "user" && item.kind !== "agent") continue;
    const ts = eventTime(item.ts);
    if (ts === undefined) continue;
    if (
      shown !== undefined &&
      ts >= shown &&
      ts - shown < QUIET_GAP_SECONDS &&
      startOfDay(new Date(ts * 1000)) === startOfDay(new Date(shown * 1000))
    )
      quiet.add(item);
    else shown = ts;
  }
  return quiet;
}
