import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { createRef } from "react";
import { TranscriptRows, type RowActions } from "./TranscriptRows";
import type { ChatItem } from "../cards";
import { messageTime } from "../../lib/messageTime";

vi.mock("../Markdown", () => ({
  Markdown: ({ children }: { children: string }) => <p>{children}</p>,
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const actions = new Proxy({}, { get: () => vi.fn() }) as RowActions;

/** Local wall-clock times, so the test holds in any time zone. */
const at = (h: number, min: number) =>
  new Date(2026, 9, 12, h, min).getTime() / 1000;

const scrollRef = createRef<HTMLDivElement>();
const rows = (items: ChatItem[]) => (
  <div ref={scrollRef}>
    <TranscriptRows
      items={items}
      activity={{}}
      activeTaskId=""
      queuedTaskIds={new Set()}
      fallback={null}
      locked={false}
      forkDisabled={false}
      actions={actions}
      scrollRef={scrollRef}
      resetKey="s1:0"
    />
  </div>
);
const view = (items: ChatItem[]) => render(rows(items));

it("prompts and answers show their time; a quick reply's stays quiet", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 12, 16, 0));
  const now = Date.now() / 1000;
  const { container } = view([
    { kind: "user", text: "Fix add", ts: at(14, 32), key: "u1" },
    { kind: "agent", text: "Fixed", ts: at(14, 33), key: "a1" },
    { kind: "user", text: "Thanks", ts: at(15, 10), key: "u2" },
    { kind: "agent", text: "No time recorded", key: "a2" },
  ]);
  const times = [...container.querySelectorAll("time")];
  expect(times).toHaveLength(3);
  const first = messageTime(at(14, 32), now)!;
  expect(times[0].textContent).toBe(first.label);
  expect(times[0].getAttribute("dateTime")).toBe(first.iso);
  expect(times[0].getAttribute("title")).toBe(first.full);
  expect(times[0].classList.contains("is-quiet")).toBe(false);
  // A minute later: shown on hover only.
  expect(times[1].classList.contains("is-quiet")).toBe(true);
  expect(times[2].classList.contains("is-quiet")).toBe(false);
  expect(times[2].textContent).toBe(messageTime(at(15, 10), now)!.label);
  // The time sits outside the actions group.
  expect(times[0].closest('[role="group"]')).toBeNull();
});

it("a streaming answer shows its time once it is complete", () => {
  const live: ChatItem = {
    kind: "agent",
    text: "Working",
    ts: at(9, 0),
    live: true,
    key: "m",
  };
  const { container, rerender } = view([live]);
  expect(container.querySelector("time")).toBeNull();
  rerender(rows([{ ...live, live: false }]));
  expect(container.querySelector("time")).toBeTruthy();
});
