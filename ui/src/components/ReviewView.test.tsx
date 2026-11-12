import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  review: vi.fn(),
  reviewFile: vi.fn(),
  reviewUndo: vi.fn(),
  taskCheckpoint: vi.fn(),
  rewindTask: vi.fn(),
  undoRewind: vi.fn(),
  git: vi.fn(),
  gitDiff: vi.fn(),
}));
vi.mock("../api", () => ({ api: mocks }));

import { ReviewView } from "./ReviewView";
import { RewindDialog } from "./RewindDialog";
import { useRewind } from "../hooks/useRewind";
import { keptKey, useTaskReview } from "../hooks/useReview";
import { notifyWorkspaceFilesChanged } from "../lib/workspaceChanges";

const hunk = (id: string, from: string, to: string) => ({
  id,
  header: `@@ -${id.slice(1)},1 +${id.slice(1)},1 @@`,
  lines: [
    { kind: "del", text: from },
    { kind: "add", text: to },
  ],
});
const detail = (hunks: ReturnType<typeof hunk>[]) => ({
  path: "src/app.ts",
  status: hunks.length ? "modified" : "unchanged",
  source: "checkpoint",
  added: hunks.length,
  removed: hunks.length,
  binary: false,
  hash: "h",
  hunks,
});

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  mocks.review.mockResolvedValue({
    task_id: "t1",
    session_id: "s1",
    workspace: "/w",
    busy: false,
    files: [
      {
        path: "src/app.ts",
        hash: "h",
        status: "modified",
        source: "checkpoint",
        added: 2,
        removed: 2,
        binary: false,
      },
      {
        path: "notes.md",
        hash: "notes-h",
        status: "added",
        source: "checkpoint",
        added: 1,
        removed: 0,
        binary: false,
      },
    ],
  });
  mocks.reviewFile.mockResolvedValue(
    detail([hunk("h1", "a - b", "a + b"), hunk("h12", "V = 1", "V = 2")]),
  );
  mocks.reviewUndo.mockResolvedValue(detail([hunk("h12", "V = 1", "V = 2")]));
});
afterEach(cleanup);

function view(busy = false) {
  const toast = vi.fn();
  render(
    <ReviewView
      taskId="t1"
      busy={busy}
      onClose={vi.fn()}
      toast={toast}
      refresh={async () => {}}
      onAskAgent={vi.fn()}
      memory={{} as never}
      onMemory={vi.fn()}
    />,
  );
  return toast;
}

describe("ReviewView", () => {
  it("lists only the task's files and undoes one hunk", async () => {
    view();
    const list = await screen.findByRole("navigation", {
      name: "Changed files",
    });
    expect(within(list).getAllByRole("button")).toHaveLength(2);
    await screen.findByText("a + b");
    fireEvent.click(
      screen.getByRole("button", { name: "Undo change @@ -1,1 +1,1 @@" }),
    );
    await waitFor(() =>
      expect(mocks.reviewUndo).toHaveBeenCalledWith("t1", "src/app.ts", "h1"),
    );
    await waitFor(() => expect(screen.queryByText("a + b")).toBeNull());
    expect(document.querySelector(".review-diff")?.textContent).toContain(
      "V = 2",
    );
  });

  it("keeps a hunk without touching the file and switches layout", async () => {
    view();
    await screen.findByText("a + b");
    fireEvent.click(
      screen.getByRole("button", { name: "Keep change @@ -1,1 +1,1 @@" }),
    );
    expect(mocks.reviewUndo).not.toHaveBeenCalled();
    expect(screen.getByText("Kept")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Split" }));
    expect(document.querySelector(".diff-split")).toBeTruthy();
  });

  it("asks before Undo all, in the app's dialog", async () => {
    view();
    await screen.findByText("a + b");
    fireEvent.click(screen.getByRole("button", { name: "Undo all" }));
    const dialog = screen.getByRole("dialog", {
      name: "Undo this task's changes?",
    });
    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Undo 2 files" }),
      );
    });
    expect(mocks.reviewUndo).toHaveBeenCalledWith(
      "t1",
      "src/app.ts",
      undefined,
    );
    expect(mocks.reviewUndo).toHaveBeenCalledWith("t1", "notes.md", undefined);
  });

  it("is read-only while a task runs", async () => {
    view(true);
    await screen.findByText("a + b");
    expect(screen.getByText(/review is read-only/)).toBeTruthy();
    const undo = screen.getByRole("button", {
      name: "Undo change @@ -1,1 +1,1 @@",
    }) as HTMLButtonElement;
    expect(undo.disabled).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Undo all" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});

describe("rewind", () => {
  it("lists the files in the confirmation", () => {
    const confirm = vi.fn();
    render(
      <RewindDialog
        paths={["src/app.ts", "notes.md"]}
        onConfirm={confirm}
        onCancel={vi.fn()}
      />,
    );
    const files = screen.getByRole("list", { name: "Files that will change" });
    expect(files.textContent).toContain("src/app.ts");
    fireEvent.click(screen.getByRole("button", { name: "Rewind 2 files" }));
    expect(confirm).toHaveBeenCalled();
  });

  it("asks, rewinds, and offers Undo in the notification", async () => {
    mocks.taskCheckpoint.mockResolvedValue({
      rewindable: true,
      checkpoint: { changes: 1, paths: ["src/app.ts"] },
    });
    mocks.rewindTask.mockResolvedValue({
      ok: true,
      restored: ["src/app.ts"],
      undo_id: "u1",
    });
    mocks.undoRewind.mockResolvedValue({
      ok: true,
      restored: ["src/app.ts"],
      task_id: "t1",
    });
    const toast = vi.fn();
    const refresh = vi.fn(async () => {});
    const { result } = renderHook(() =>
      useRewind({ busy: false, refresh, toast }),
    );
    await act(() => result.current.ask("t1"));
    expect(result.current.asking).toEqual({
      taskId: "t1",
      paths: ["src/app.ts"],
    });
    expect(mocks.rewindTask).not.toHaveBeenCalled();
    await act(() => result.current.confirm());
    expect(mocks.rewindTask).toHaveBeenCalledWith("t1");
    expect(result.current.asking).toBeNull();
    const [text, kind, action] = toast.mock.calls.at(-1)!;
    expect(text).toBe("Restored 1 file.");
    expect(kind).toBe("ok");
    expect(action.label).toBe("Undo");
    await act(async () => action.run());
    await waitFor(() => expect(mocks.undoRewind).toHaveBeenCalledWith("u1"));
  });

  it("does not ask while a task runs", async () => {
    const toast = vi.fn();
    const { result } = renderHook(() =>
      useRewind({ busy: true, refresh: async () => {}, toast }),
    );
    await act(() => result.current.ask("t1"));
    expect(result.current.asking).toBeNull();
    expect(toast).toHaveBeenCalledWith(
      "Stop the task before rewinding its files.",
      "info",
    );
  });
});

describe("revision-bound review markers", () => {
  const toast = vi.fn();
  const refresh = vi.fn(async () => {});
  const response = (hash = "v1", taskId = "t1") => ({
    task_id: taskId,
    session_id: "s1",
    workspace: "/w",
    busy: false,
    files: [{ ...detail([hunk("h1", "old", "new")]), hash }],
  });
  const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  };
  function reviewHook(task = "t1") {
    return renderHook(
      ({ taskId }) => useTaskReview({ taskId, appBusy: false, toast, refresh }),
      { initialProps: { taskId: task } },
    );
  }
  function server() {
    let revision = "v1";
    mocks.review.mockImplementation(async (id: string) =>
      response(revision, id),
    );
    mocks.reviewFile.mockImplementation(async () => ({
      ...detail([hunk("h1", "old", revision)]),
      hash: revision,
    }));
    return (next: string) => {
      revision = next;
    };
  }

  it("invalidates kept files and reused hunk IDs after an external edit, permanently across remount", async () => {
    const change = server();
    const hook = reviewHook();
    await waitFor(() => expect(hook.result.current.detail?.hash).toBe("v1"));
    act(() => {
      hook.result.current.keepHunk("src/app.ts", "h1");
      hook.result.current.keepFile("src/app.ts");
    });
    expect(hook.result.current.kept).toEqual({
      files: ["src/app.ts"],
      hunks: ["src/app.ts#h1"],
    });
    expect(mocks.reviewUndo).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(keptKey("t1"))!).files).toEqual([
      { path: "src/app.ts", hash: "v1" },
    ]);
    change("v2");
    act(() => notifyWorkspaceFilesChanged("/w"));
    expect(hook.result.current.kept.files).toEqual([]);
    await waitFor(() => expect(hook.result.current.detail?.hash).toBe("v2"));
    expect(hook.result.current.kept).toEqual({ files: [], hunks: [] });
    hook.unmount();
    change("v1");
    const reopened = reviewHook();
    await waitFor(() =>
      expect(reopened.result.current.detail?.hash).toBe("v1"),
    );
    expect(reopened.result.current.kept).toEqual({ files: [], hunks: [] });
  });

  it("removes the visible Kept state on focus refresh after a real revision change", async () => {
    const change = server();
    view();
    await screen.findByText("v1");
    fireEvent.click(screen.getByRole("button", { name: "Keep file" }));
    expect(
      (
        screen.getByRole("button", {
          name: "Kept",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    change("v2");
    act(() => window.dispatchEvent(new Event("focus")));
    await screen.findByText("v2");
    expect(
      (screen.getByRole("button", { name: "Keep file" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(mocks.reviewUndo).not.toHaveBeenCalled();
  });

  it("refreshing unchanged content keeps the marker and refetches the cleared detail", async () => {
    server();
    const hook = reviewHook();
    await waitFor(() => expect(hook.result.current.detail?.hash).toBe("v1"));
    act(() => hook.result.current.keepFile("src/app.ts"));
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(hook.result.current.detail?.hash).toBe("v1"));
    expect(hook.result.current.kept.files).toEqual(["src/app.ts"]);
    act(() => hook.result.current.setSelected("src/app.ts"));
    expect(hook.result.current.detail?.hash).toBe("v1");
  });

  it("does not let a pre-undo listing revive old content or marks", async () => {
    const change = server();
    const hook = reviewHook();
    await waitFor(() => expect(hook.result.current.detail?.hash).toBe("v1"));
    act(() => hook.result.current.keepHunk("src/app.ts", "h1"));
    const late = deferred<ReturnType<typeof response>>();
    mocks.review.mockReturnValueOnce(late.promise);
    let pending!: Promise<unknown>;
    act(() => {
      pending = hook.result.current.reload();
    });
    mocks.reviewUndo.mockImplementationOnce(async () => {
      change("v2");
      return { ...detail([hunk("h1", "old", "v2")]), hash: "v2" };
    });
    await act(async () => {
      await hook.result.current.undo("src/app.ts", "h1");
    });
    await act(async () => {
      late.resolve(response("v1"));
      await pending;
    });
    expect(hook.result.current.detail?.hash).toBe("v2");
    expect(hook.result.current.kept.hunks).toEqual([]);
  });

  it("keeps a newly selected file visible when another file's undo finishes", async () => {
    server();
    const notes = {
      ...detail([hunk("h3", "old notes", "new notes")]),
      path: "notes.md",
      hash: "notes",
    };
    mocks.review.mockResolvedValue({
      ...response(),
      files: [...response().files, notes],
    });
    mocks.reviewFile.mockImplementation(async (_task: string, path: string) =>
      path === "notes.md"
        ? notes
        : { ...detail([hunk("h1", "old", "v1")]), hash: "v1" },
    );
    const hook = reviewHook();
    await waitFor(() => expect(hook.result.current.detail?.hash).toBe("v1"));
    const pending = deferred<ReturnType<typeof detail>>();
    mocks.reviewUndo.mockReturnValueOnce(pending.promise);
    let undo!: Promise<boolean>;
    act(() => {
      undo = hook.result.current.undo("src/app.ts");
    });
    act(() => hook.result.current.setSelected("notes.md"));
    await waitFor(() =>
      expect(hook.result.current.detail?.path).toBe("notes.md"),
    );
    await act(async () => {
      pending.resolve({ ...detail([]), hash: "v1" });
      await undo;
    });
    expect(hook.result.current.selected).toBe("notes.md");
    expect(hook.result.current.detail?.path).toBe("notes.md");
  });

  it("rejects legacy marks and restores digest-bound marks only after validating the listing", async () => {
    server();
    localStorage.setItem(
      keptKey("t1"),
      JSON.stringify({ files: ["src/app.ts"], hunks: ["src/app.ts#h1"] }),
    );
    const old = reviewHook();
    await waitFor(() => expect(old.result.current.detail?.hash).toBe("v1"));
    expect(old.result.current.kept).toEqual({ files: [], hunks: [] });
    act(() => old.result.current.keepFile("src/app.ts"));
    old.unmount();
    const restored = reviewHook();
    expect(restored.result.current.kept.files).toEqual([]);
    await waitFor(() =>
      expect(restored.result.current.kept.files).toEqual(["src/app.ts"]),
    );
  });

  it("does not trust absent summary digests or unavailable files", async () => {
    server();
    const row = response();
    mocks.review.mockResolvedValue({
      ...row,
      files: [{ ...row.files[0], hash: undefined }],
    });
    const hook = reviewHook();
    await waitFor(() => expect(hook.result.current.detail).not.toBeNull());
    act(() => hook.result.current.keepFile("src/app.ts"));
    expect(hook.result.current.kept.files).toEqual([]);
    mocks.review.mockResolvedValue(response());
    await act(async () => {
      await hook.result.current.reload();
    });
    await waitFor(() => expect(hook.result.current.detail?.hash).toBe("v1"));
    act(() => hook.result.current.keepFile("src/app.ts"));
    mocks.review.mockResolvedValue({
      ...row,
      files: [{ ...row.files[0], status: "unavailable" }],
    });
    await act(async () => {
      await hook.result.current.reload();
    });
    expect(hook.result.current.kept.files).toEqual([]);
  });

  it("ignores old list responses after newer content and after a keep action", async () => {
    const change = server();
    const hook = reviewHook();
    await waitFor(() => expect(hook.result.current.detail?.hash).toBe("v1"));
    const late = deferred<ReturnType<typeof response>>();
    mocks.review.mockReturnValueOnce(late.promise);
    let pending!: Promise<unknown>;
    act(() => {
      pending = hook.result.current.reload();
    });
    act(() => hook.result.current.keepFile("src/app.ts"));
    change("v2");
    await act(async () => {
      await hook.result.current.reload();
    });
    await waitFor(() => expect(hook.result.current.detail?.hash).toBe("v2"));
    act(() => hook.result.current.keepFile("src/app.ts"));
    await act(async () => {
      late.resolve(response("v1"));
      await pending;
    });
    expect(hook.result.current.files?.[0].hash).toBe("v2");
    expect(JSON.parse(localStorage.getItem(keptKey("t1"))!).files[0].hash).toBe(
      "v2",
    );
  });

  it("discards a detail response overtaken by a new summary revision", async () => {
    const change = server();
    const late = deferred<ReturnType<typeof detail>>();
    mocks.reviewFile.mockReturnValueOnce(late.promise);
    const hook = reviewHook();
    await waitFor(() => expect(mocks.reviewFile).toHaveBeenCalled());
    change("v2");
    await act(async () => {
      await hook.result.current.reload();
    });
    await waitFor(() => expect(hook.result.current.detail?.hash).toBe("v2"));
    await act(async () => {
      late.resolve({ ...detail([hunk("h1", "old", "v1")]), hash: "v1" });
    });
    expect(hook.result.current.detail?.hash).toBe("v2");
  });

  it("rejects mismatched summary/detail revisions instead of marking unseen content", async () => {
    server();
    mocks.reviewFile.mockResolvedValue({
      ...detail([hunk("h1", "old", "v2")]),
      hash: "v2",
    });
    const hook = reviewHook();
    await waitFor(() =>
      expect(hook.result.current.error).toContain("changed while"),
    );
    act(() => hook.result.current.keepFile("src/app.ts"));
    expect(hook.result.current.detail).toBeNull();
    expect(hook.result.current.kept.files).toEqual([]);
  });

  it("isolates task storage and ignores an old task's late listing", async () => {
    server();
    const late = deferred<ReturnType<typeof response>>();
    mocks.review.mockReturnValueOnce(late.promise);
    const hook = reviewHook();
    hook.rerender({ taskId: "t2" });
    await waitFor(() => expect(hook.result.current.detail?.hash).toBe("v1"));
    act(() => hook.result.current.keepFile("src/app.ts"));
    await act(async () => {
      late.resolve(response("old", "t1"));
    });
    expect(hook.result.current.files?.[0].hash).toBe("v1");
    expect(localStorage.getItem(keptKey("t1"))).toBeNull();
    expect(JSON.parse(localStorage.getItem(keptKey("t2"))!).files[0].hash).toBe(
      "v1",
    );
  });

  it("Undo all skips matching file marks but not changed revisions or hunk-only marks", async () => {
    const change = server();
    const hook = reviewHook();
    await waitFor(() => expect(hook.result.current.detail?.hash).toBe("v1"));
    act(() => hook.result.current.keepFile("src/app.ts"));
    await act(async () => {
      await hook.result.current.undoAll();
    });
    expect(mocks.reviewUndo).not.toHaveBeenCalled();
    change("v2");
    await act(async () => {
      await hook.result.current.undoAll();
    });
    expect(mocks.reviewUndo).toHaveBeenCalledExactlyOnceWith(
      "t1",
      "src/app.ts",
      undefined,
    );
    await waitFor(() => expect(hook.result.current.detail?.hash).toBe("v2"));
    act(() => hook.result.current.keepHunk("src/app.ts", "h1"));
    await act(async () => {
      await hook.result.current.undoAll();
    });
    expect(mocks.reviewUndo).toHaveBeenCalledTimes(2);
  });
  it.each(["rejected", "busy", "no-op", "single-error"])(
    "recovers an invalidated pending diff after %s undo without changing selection",
    async (outcome) => {
      server();
      const pending = deferred<ReturnType<typeof detail>>();
      mocks.reviewFile.mockImplementationOnce(() => pending.promise);
      const hook = reviewHook();
      await waitFor(() => expect(mocks.reviewFile).toHaveBeenCalledTimes(1));
      const current = response("v1");
      if (outcome === "busy") current.busy = true;
      if (outcome === "no-op") current.files[0].status = "unchanged";
      mocks.review.mockResolvedValue(current);
      mocks.reviewUndo.mockRejectedValueOnce(
        new Error("Workspace became busy"),
      );
      await act(async () => {
        if (outcome === "single-error")
          await hook.result.current.undo("src/app.ts");
        else await hook.result.current.undoAll();
      });
      await waitFor(() => expect(hook.result.current.detail?.hash).toBe("v1"));
      expect(hook.result.current.working).toBe(false);
      expect(mocks.reviewFile).toHaveBeenCalledTimes(2);
      await act(async () =>
        pending.resolve({ ...detail([]), hash: "obsolete" }),
      );
      expect(hook.result.current.detail?.hash).toBe("v1");
      expect(hook.result.current.selected).toBe("src/app.ts");
    },
  );
});
