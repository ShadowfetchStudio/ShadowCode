import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { useRef } from "react";
import { api, type EventRow } from "../api";
import type { ChatItem } from "../components/cards";
import {
  ROW_WINDOW,
  TranscriptRows,
  type RowActions,
} from "../components/shell/TranscriptRows";
import { useFind, type FindHistory } from "./useFind";

vi.mock("../api", () => ({ api: { historyPage: vi.fn() } }));
vi.mock("../components/Markdown", () => ({
  Markdown: ({ children }: { children: string }) => (
    <div className="markdown">{children}</div>
  ),
}));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

const actions = new Proxy({} as RowActions, { get: () => vi.fn() });
const notes = (count: number, word = "Note"): ChatItem[] =>
  Array.from({ length: count }, (_, i) => ({
    kind: "note",
    text: `${word} ${i + 1}`,
    key: `e:${word}:${i + 1}`,
  }));
const latest = (): FindHistory => ({
  viewing: false,
  firstCursor: 0,
  base: null,
  latest: vi.fn(),
  show: vi.fn(async () => undefined),
});

function Harness({
  items,
  history = latest(),
  queued = new Set<string>(),
  release = () => undefined,
}: {
  items: ChatItem[];
  history?: FindHistory;
  queued?: ReadonlySet<string>;
  release?: () => void;
}) {
  const streamRef = useRef<HTMLDivElement>(null);
  const find = useFind({
    open: true,
    hidden: false,
    sessionId: "s1",
    liveItems: items,
    queuedTaskIds: queued,
    history,
    streamRef,
    release,
    onClose: () => undefined,
  });
  return (
    <>
      <input
        aria-label="Query"
        value={find.query}
        onChange={(e) => find.setQuery(e.target.value)}
      />
      <output aria-label="Count">{find.label}</output>
      <button type="button" onClick={find.next}>
        Next
      </button>
      <button type="button" onClick={find.previous}>
        Previous
      </button>
      <div ref={streamRef}>
        <TranscriptRows
          items={items}
          activity={{}}
          activeTaskId=""
          queuedTaskIds={queued}
          fallback={null}
          locked={false}
          forkDisabled={false}
          actions={actions}
          scrollRef={streamRef}
          resetKey="s1:0"
          reveal={find.reveal}
        />
      </div>
    </>
  );
}

async function type(text: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "Query" }), {
    target: { value: text },
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
}
const count = () => screen.getByRole("status", { name: "Count" }).textContent;
const step = async (name: "Next" | "Previous") => {
  fireEvent.click(screen.getByRole("button", { name }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
};

it("finds rows the transcript has not drawn and draws the current one", async () => {
  const release = vi.fn();
  render(<Harness items={notes(ROW_WINDOW + 50)} release={release} />);
  expect(screen.queryByText("Note 12")).toBeNull();
  // "Note 12" and "Note 120" … "Note 129", whatever the case.
  await type("NOTE  12");
  // It starts on the latest match, which is drawn.
  expect(count()).toBe("11 of 11");
  await step("Next");
  expect(count()).toBe("1 of 11");
  const row = screen.getByText("Note 12").closest("[data-find-row]")!;
  // No highlight API here: the match's row is marked instead.
  expect(row.getAttribute("data-find-current")).toBe("row");
  expect(release).toHaveBeenCalled();
  await step("Previous");
  expect(count()).toBe("11 of 11");
  expect(row.hasAttribute("data-find-current")).toBe(false);
  await type("no such note");
  expect(count()).toBe("No matches");
  await type("");
  expect(count()).toBe("");
});

it("leaves out a queued follow-up, which the transcript does not show", async () => {
  const items: ChatItem[] = [
    ...notes(2),
    { kind: "user", text: "Queued question", taskId: "q", key: "u" },
  ];
  render(<Harness items={items} queued={new Set(["q"])} />);
  await type("queued");
  expect(count()).toBe("No matches");
});

const saved = (from: number, to: number): EventRow[] =>
  Array.from({ length: to - from + 1 }, (_, i) => ({
    id: from + i,
    ts: 1,
    type: "user.message",
    task_id: `t${from + i}`,
    payload: { text: `Saved ${from + i}` },
  }));

it("reads saved pages one by one and opens the page a match is on", async () => {
  vi.mocked(api.historyPage).mockImplementation(async (_, before) =>
    before === 101
      ? {
          events: saved(51, 100),
          first_cursor: 51,
          event_cursor: 100,
          has_older: true,
        }
      : {
          events: saved(1, 50),
          first_cursor: 1,
          event_cursor: 50,
          has_older: false,
        },
  );
  const history = {
    ...latest(),
    base: { first_cursor: 101, has_older: true },
  };
  render(<Harness items={notes(3, "Live")} history={history} />);
  await type("saved 7");
  expect(api.historyPage).toHaveBeenNthCalledWith(1, "s1", 101);
  expect(api.historyPage).toHaveBeenNthCalledWith(2, "s1", 51);
  // "Saved 7" (the oldest page) and "Saved 70" … "Saved 79". Nothing in
  // the latest messages, so it starts on the latest match and opens its
  // page, as Older messages would.
  expect(count()).toBe("11 of 11");
  expect(history.show).toHaveBeenLastCalledWith(101, [0]);
  await step("Next");
  expect(count()).toBe("1 of 11");
  expect(history.show).toHaveBeenLastCalledWith(51, [0, 101]);
  // Each page is read once per conversation, whatever the query.
  await type("saved 4");
  expect(count()).toBe("11 of 11");
  expect(api.historyPage).toHaveBeenCalledTimes(2);
});

it("closes when Review or Compare replaces the conversation, or another opens", () => {
  const onClose = vi.fn();
  const props = {
    open: true,
    hidden: false,
    sessionId: "s1",
    liveItems: notes(2),
    queuedTaskIds: new Set<string>(),
    history: latest(),
    streamRef: { current: null },
    release: () => undefined,
    onClose,
  };
  const { rerender } = renderHook((p: typeof props) => useFind(p), {
    initialProps: props,
  });
  expect(onClose).not.toHaveBeenCalled();
  rerender({ ...props, hidden: true });
  expect(onClose).toHaveBeenCalledTimes(1);
  rerender({ ...props, sessionId: "s2" });
  expect(onClose).toHaveBeenCalledTimes(2);
});
