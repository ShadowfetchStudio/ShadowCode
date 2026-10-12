import { describe, expect, it } from "vitest";
import type { ChatItem } from "../components/cards";
import {
  QUIET_GAP_SECONDS,
  eventTime,
  messageTime,
  quietTimes,
} from "./messageTime";

/** Local wall-clock times, so the tests hold in any time zone. */
const at = (y: number, m: number, d: number, h: number, min: number) =>
  new Date(y, m - 1, d, h, min).getTime() / 1000;

describe("message times", () => {
  const now = at(2026, 10, 12, 16, 5);
  const label = (ts: number, locale = "en-GB") =>
    messageTime(ts, now, locale)?.label;

  it("says the time today, Yesterday, the date this year, the year before", () => {
    expect(label(at(2026, 10, 12, 14, 32))).toBe("14:32");
    expect(label(at(2026, 10, 12, 0, 1))).toBe("00:01");
    expect(label(at(2026, 10, 11, 14, 32))).toBe("Yesterday 14:32");
    expect(label(at(2026, 10, 11, 23, 59))).toBe("Yesterday 23:59");
    expect(label(at(2026, 10, 3, 9, 15))).toBe("3 Oct, 09:15");
    expect(label(at(2026, 1, 1, 9, 15))).toBe("1 Jan, 09:15");
    expect(label(at(2025, 12, 31, 23, 0))).toBe("31 Dec 2025");
  });

  it("follows the viewer's locale", () => {
    expect(label(at(2026, 10, 12, 14, 32), "en-US")).toMatch(/^2:32\sPM$/);
    expect(label(at(2026, 10, 11, 9, 5), "en-US")).toMatch(
      /^Yesterday 9:05\sAM$/,
    );
    expect(label(at(2026, 10, 3, 9, 15), "en-US")).toMatch(/^Oct 3, 9:15\sAM$/);
    expect(label(at(2026, 10, 3, 9, 15), "de-DE")).toBe("3. Okt., 09:15");
  });

  it("gives the full date and time for the tooltip and a machine time", () => {
    const ts = at(2026, 10, 11, 14, 32);
    const time = messageTime(ts, now, "en-GB");
    expect(time?.full).toMatch(/^Sunday,? 11 October 2026.* 14:32$/);
    expect(time?.iso).toBe(new Date(ts * 1000).toISOString());
  });

  it("a later day (a clock set wrong) shows its date, not a bare time", () => {
    expect(label(at(2026, 10, 13, 8, 0))).toBe("13 Oct, 08:00");
  });

  it("words follow the clock: today's time is Yesterday after midnight", () => {
    const ts = at(2026, 10, 12, 23, 50);
    expect(messageTime(ts, at(2026, 10, 12, 23, 55), "en-GB")?.label).toBe(
      "23:50",
    );
    expect(messageTime(ts, at(2026, 10, 13, 0, 5), "en-GB")?.label).toBe(
      "Yesterday 23:50",
    );
  });

  it("never makes up a time", () => {
    expect(messageTime(0, now)).toBeNull();
    expect(messageTime(Number.NaN, now)).toBeNull();
    expect(eventTime(undefined)).toBeUndefined();
    expect(eventTime("1790000000")).toBeUndefined();
    expect(eventTime(-5)).toBeUndefined();
    expect(eventTime(1_790_000_000.25)).toBe(1_790_000_000.25);
  });
});

describe("quiet times", () => {
  const user = (ts?: number): ChatItem => ({ kind: "user", text: "Q", ts });
  const agent = (ts?: number): ChatItem => ({ kind: "agent", text: "A", ts });
  const note: ChatItem = { kind: "note", text: "Using Codex" };
  const start = at(2026, 10, 12, 14, 0);

  it("a quick exchange shows its time once", () => {
    const items = [user(start), note, agent(start + 40), user(start + 120)];
    const quiet = quietTimes(items);
    expect(quiet.has(items[0])).toBe(false);
    expect(quiet.has(items[2])).toBe(true);
    expect(quiet.has(items[3])).toBe(true);
  });

  it("shows the time again a few minutes after the last one shown", () => {
    const step = QUIET_GAP_SECONDS - 60;
    const items = [0, 1, 2, 3].map((n) => agent(start + n * step));
    const quiet = quietTimes(items);
    expect(items.map((item) => quiet.has(item))).toEqual([
      false,
      true,
      false,
      true,
    ]);
  });

  it("a new day, an earlier time or a message without one is never quiet", () => {
    const late = at(2026, 10, 12, 23, 58);
    const items = [
      user(late),
      agent(at(2026, 10, 13, 0, 1)),
      user(late),
      agent(undefined),
      agent(late + 30),
    ];
    const quiet = quietTimes(items);
    expect(quiet.has(items[1])).toBe(false);
    expect(quiet.has(items[2])).toBe(false);
    expect(quiet.has(items[3])).toBe(false);
    expect(quiet.has(items[4])).toBe(true);
  });
});
