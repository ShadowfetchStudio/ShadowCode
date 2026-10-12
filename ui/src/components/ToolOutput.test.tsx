import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { ToolOutput } from "./ToolOutput";
import { ActivityTimeline } from "./ActivityTimeline";
import { emptyActivity, type TaskActivity } from "../lib/activity";
import { OUTPUT_MAX_LINES } from "../lib/toolOutput";
import { COPIED_MS } from "../hooks/useCopyFeedback";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const numbered = (count: number) =>
  Array.from({ length: count }, (_, i) => `line ${i + 1}`).join("\n");

it("long output shows all of it on request, and less again", () => {
  const text = numbered(900);
  const { container } = render(<ToolOutput text={text} name="npm test" />);
  const pre = () => container.querySelector("pre")!.textContent;
  expect(pre()).not.toContain("line 900");
  fireEvent.click(
    screen.getByRole("button", {
      name: "Show all (900 lines) of the output of npm test",
    }),
  );
  expect(pre()).toBe(text);
  fireEvent.click(
    screen.getByRole("button", { name: "Show less of the output of npm test" }),
  );
  expect(pre()).not.toContain("line 900");
});

it("huge output says which part it shows", () => {
  const text = numbered(OUTPUT_MAX_LINES + 1);
  render(<ToolOutput text={text} name="cargo build" />);
  fireEvent.click(screen.getByRole("button", { name: /^Show all/ }));
  expect(
    screen.getByText(
      "Showing the last 2,000 of 2,001 lines. Copy includes all of it.",
    ),
  ).toBeTruthy();
});

it("short output has Copy and nothing to expand", () => {
  render(<ToolOutput text="Tests 4 passed (4)" name="npm test" />);
  expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
  expect(
    screen.getByRole("button", { name: "Copy the output of npm test" }),
  ).toBeTruthy();
});

it("Copy copies the whole output and says Copied for a moment", async () => {
  vi.useFakeTimers();
  const writeText = vi.fn(async () => {});
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const text = numbered(OUTPUT_MAX_LINES + 10);
  render(<ToolOutput text={text} name="npm test" />);
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Copy the output of npm test" }),
    );
  });
  expect(writeText).toHaveBeenCalledWith(text);
  const done = screen.getByRole("button", {
    name: "Copied the output of npm test",
  });
  expect(done.textContent).toBe("Copied");
  act(() => {
    vi.advanceTimersByTime(COPIED_MS);
  });
  expect(
    screen.getByRole("button", { name: "Copy the output of npm test" })
      .textContent,
  ).toBe("Copy");
});

it("a timeline step's output offers Show all and Copy for that command", () => {
  const activity: TaskActivity = {
    ...emptyActivity("t1"),
    calls: [
      {
        callId: "c1",
        tool: "exec",
        step: "testing",
        label: "exec",
        command: "npm test",
        live: false,
        ok: true,
        output: numbered(600),
      },
    ],
  } as TaskActivity;
  render(<ActivityTimeline activity={activity} />);
  expect(
    screen.getByRole("button", {
      name: "Show all (600 lines) of the output of npm test",
      hidden: true,
    }),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", {
      name: "Copy the output of npm test",
      hidden: true,
    }),
  ).toBeTruthy();
});
