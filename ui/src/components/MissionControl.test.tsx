import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MissionControl } from "./MissionControl";
import { api } from "../api";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MissionControl", () => {
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
