import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { createRef, type ComponentProps } from "react";
import type { Job } from "../../api";
import { ChatView } from "./ChatView";

afterEach(cleanup);

const props = (
  over: Partial<ComponentProps<typeof ChatView>> = {},
): ComponentProps<typeof ChatView> => ({
  hidden: false,
  streamRef: createRef<HTMLDivElement>(),
  onScroll: () => undefined,
  empty: false,
  switching: false,
  shutdown: null,
  onRetryQuit: () => undefined,
  error: "",
  canTrust: false,
  onTrust: () => undefined,
  onDismissError: () => undefined,
  history: {
    enabled: false,
    viewing: false,
    hasOlder: false,
    loading: false,
    error: "",
  },
  onOlder: () => undefined,
  onNewer: () => undefined,
  onLatest: () => undefined,
  onSuggestion: () => undefined,
  needsModel: false,
  onChooseModel: () => undefined,
  rows: <p>Streaming answer…</p>,
  commandCards: [],
  approvals: [],
  onDecide: vi.fn(),
  working: false,
  activity: undefined,
  job: null,
  busy: false,
  onToast: () => undefined,
  ...over,
});

it("is a named conversation log that does not read out streaming text", () => {
  const job: Job = {
    id: "j1",
    session_id: "s1",
    workspace: "/work/demo",
    event_cursor: 0,
    started_at: 1,
    status: "running",
  };
  render(<ChatView {...props({ working: true, busy: true, job })} />);
  const log = screen.getByRole("log", { name: "Conversation" });
  expect(log.getAttribute("aria-live")).toBe("off");
  expect(log.textContent).toContain("Streaming answer…");
  // The running timeline (with its ticking clock) is not a live region
  // either; the stage's milestone region speaks for it.
  expect(log.querySelector(".working")).toBeTruthy();
  expect(
    Array.from(log.querySelectorAll("[aria-live], [role=status]")).filter(
      (el) => el.closest(".working"),
    ),
  ).toEqual([]);
});
