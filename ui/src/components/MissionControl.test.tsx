import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MissionControl } from "./MissionControl";
import { api, type Approval, type Job } from "../api";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MissionControl", () => {
  it.each([
    { name: "task-specific approvals", request: {task_id: "t1"}, active: 2, expected: "First change" },
    { name: "legacy session signal", request: undefined, active: 1, expected: "First change" },
    { name: "ambiguous session signal", request: undefined, active: 2, expected: "Session summary" },
    { name: "unlisted task", request: {task_id: "other"}, active: 1, expected: "Session summary" },
  ])("attributes $name once and keeps completed work out of the queue", async ({request, active, expected}) => {
    vi.spyOn(api, "worktrees").mockResolvedValue({ workspace: "/repo", worktrees: [] });
    vi.spyOn(api, "background").mockResolvedValue({ tasks: [] });
    const jobs: Job[] = ["Old change", "First change", "Second change"].slice(0, active + 1)
      .map((task, i) => ({id: `j${i}`, task_id: `t${i}`, session_id: "s", workspace: "/repo",
        event_cursor: 0, started_at: i, status: i ? "running" : "completed", task}));
    const approvals: Approval[] = request ? ["a", "b"].map(id => ({ id, session_id: "s", ...request })) : [];
    render(<MissionControl workspace="/repo" sessions={[{id: "s", title: "Session summary", workspace: "/repo", status: "running", updated_at: 1}]}
      jobs={jobs} approvals={approvals} waitingSessions={["s"]}
      onOpenSession={vi.fn()} onNewTask={vi.fn()} onDecide={vi.fn()} onOpenPanel={vi.fn()}
      onClose={vi.fn()} toast={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", {name: /Needs approval\s*1/}));
    const [card] = await screen.findAllByRole("article");
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(card).toHaveTextContent(expected);
    expect(card).not.toHaveTextContent("Old change");
    if (expected === "Session summary") expect(card).not.toHaveTextContent("First change");
  });

  it("renders KPI summary, triages pending approvals, filters tasks, and displays infrastructure", async () => {
    vi.spyOn(api, "worktrees").mockResolvedValue({
      workspace: "/work/demo",
      worktrees: [
        {
          id: "wt-1",
          source: "/work/demo",
          path: "/work/demo-wt",
          branch: "feat/mission",
          base_commit: "abc123",
          common_directory: "/work/demo/.git",
          state: "active",
          created_at: 1000,
          detail: "",
        },
      ],
    });
    vi.spyOn(api, "background").mockResolvedValue({
      tasks: [
        {
          id: "bg-1",
          name: "dev-server",
          command: "npm run dev",
          status: "running",
          started_at: 1000,
          pid: 1234,
          exit_code: null,
          output: "",
        },
      ],
    });

    const onDecide = vi.fn();
    const onOpenSession = vi.fn();
    const onCancelJob = vi.fn().mockResolvedValue(undefined);
    const onOpenPanel = vi.fn();
    const onClose = vi.fn();
    const onNewTask = vi.fn();
    const toast = vi.fn();

    render(
      <MissionControl
        workspace="/work/demo"
        sessions={[
          { id: "s1", title: "Fix login race", workspace: "/work/demo", status: "running", updated_at: 2000 },
          { id: "s2", title: "Refactor CSS", workspace: "/work/demo", status: "completed", updated_at: 1500 },
        ]}
        jobs={[
          {
            id: "j1",
            session_id: "s1",
            workspace: "/work/demo",
            status: "running",
            task: "Fix login race",
            model: "claude-sonnet",
            event_cursor: 1,
            started_at: 2000,
          },
          {
            id: "j2",
            session_id: "s2",
            workspace: "/work/demo",
            status: "completed",
            task: "Refactor CSS",
            model: "local-qwen",
            event_cursor: 2,
            started_at: 1400,
            finished_at: 1500,
          },
        ]}
        approvals={[
          {
            id: "a1",
            session_id: "s1",
            tool: "run_command",
            reason: "Run integration tests",
          },
        ]}
        waitingSessions={["s1"]}
        onOpenSession={onOpenSession}
        onNewTask={onNewTask}
        onDecide={onDecide}
        onCancelJob={onCancelJob}
        onOpenPanel={onOpenPanel}
        onClose={onClose}
        toast={toast}
      />,
    );

    expect(screen.getByRole("heading", { name: "Mission Control" })).toBeInTheDocument();
    expect(screen.getByText("Pending approvals (1)")).toBeInTheDocument();
    expect(screen.getByText("Run integration tests")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(onDecide).toHaveBeenCalledWith("a1", { decision: "approve" });

    const search = screen.getByRole("searchbox", {name: "Search execution deck"});
    fireEvent.change(search, {target: {value: "demo qwen"}});
    expect(screen.getByRole("heading", { name: "Refactor CSS" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Fix login race" })).toBeNull();
    fireEvent.change(search, {target: {value: ""}});
    fireEvent.click(screen.getByRole("tab", { name: /Completed/i }));
    expect(screen.getByText("Refactor CSS")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Fix login race" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /Working/i }));
    expect(screen.getByRole("heading", { name: "Fix login race" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(onCancelJob).toHaveBeenCalledWith("j1"));

    await waitFor(() => {
      expect(screen.getByText("feat/mission")).toBeInTheDocument();
      expect(screen.getByText("dev-server")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Back to chat" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
