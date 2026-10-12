import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import type { Approval, Job } from "../../api";
import {
  MILESTONE_MS,
  Milestones,
  approvalMilestone,
  jobMilestone,
} from "./Milestones";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const job = (status: string, id = "j1"): Job => ({
  id,
  session_id: "s1",
  workspace: "/work/demo",
  event_cursor: 0,
  started_at: 1,
  status,
});
const approval = (id: string, command: string): Approval => ({
  id,
  session_id: "s1",
  tool: "exec",
  command,
  reason: "Run a shell command as your user",
  preview: { kind: "command", command, cwd: "/work/demo" },
});

it("speaks only as the open conversation's task ends", () => {
  expect(jobMilestone(job("running"), job("completed"))).toBe(
    "Answer finished",
  );
  expect(jobMilestone(job("running"), job("failed"))).toBe("Task failed");
  expect(jobMilestone(job("cancelling"), job("cancelled"))).toBe(
    "Task stopped",
  );
  expect(jobMilestone(job("paused"), job("limit_reached"))).toBe(
    "Task stopped at the plan limit",
  );
  // Starting, running and opening a finished task say nothing.
  expect(jobMilestone(null, job("running"))).toBe("");
  expect(jobMilestone(job("queued"), job("running"))).toBe("");
  expect(jobMilestone(job("running", "j0"), job("completed"))).toBe("");
  expect(jobMilestone(job("completed"), job("completed"))).toBe("");
  expect(jobMilestone(job("running"), null)).toBe("");
});

it("names the action that waits, or how many", () => {
  expect(approvalMilestone([approval("a1", "npm test")])).toBe(
    "Approval needed: npm test",
  );
  expect(
    approvalMilestone([approval("a1", "npm test"), approval("a2", "ls")]),
  ).toBe("2 approvals needed. First: npm test");
  expect(approvalMilestone([])).toBe("");
});

function region(container: HTMLElement) {
  const live = container.querySelector(".milestones")!;
  expect(live.getAttribute("aria-live")).toBe("polite");
  expect(live.classList.contains("sr-only")).toBe(true);
  return () => Array.from(live.children).map((p) => p.textContent);
}

it("announces each milestone once, in one polite region", () => {
  const first = approval("a1", "npm test");
  const { container, rerender } = render(
    <Milestones job={job("running")} approvals={[]} />,
  );
  const said = region(container);
  expect(said()).toEqual([]);
  rerender(<Milestones job={job("running")} approvals={[first]} />);
  expect(said()).toEqual(["Approval needed: npm test"]);
  // The same approval again (a later feed read) is not news.
  rerender(<Milestones job={job("running")} approvals={[{ ...first }]} />);
  rerender(<Milestones job={job("completed")} approvals={[]} />);
  expect(said()).toEqual(["Approval needed: npm test", "Answer finished"]);
  // Another task ending the same way is said again, as a new line.
  rerender(<Milestones job={job("running", "j2")} approvals={[]} />);
  rerender(<Milestones job={job("completed", "j2")} approvals={[]} />);
  expect(said()).toEqual([
    "Approval needed: npm test",
    "Answer finished",
    "Answer finished",
  ]);
  // Then it clears, so reading the page later finds nothing stale.
  act(() => vi.advanceTimersByTime(MILESTONE_MS));
  expect(said()).toEqual([]);
});

it("says nothing for a finished task that is opened", () => {
  const { container, rerender } = render(
    <Milestones job={job("running", "j1")} approvals={[]} />,
  );
  const said = region(container);
  rerender(<Milestones job={job("failed", "j9")} approvals={[]} />);
  rerender(<Milestones job={null} approvals={[]} />);
  expect(said()).toEqual([]);
});
