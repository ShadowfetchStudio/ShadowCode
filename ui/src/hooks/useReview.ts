import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type ReviewFile, type ReviewFileDetail } from "../api";
import { readStore, writeStore } from "../lib/storage";
import type { ToastKind } from "./useToasts";
import { onWorkspaceFilesChanged } from "../lib/workspaceChanges";
import { onVerificationRefresh } from "../lib/verificationRefresh";

/** Which task the full-width Review view shows, if any. */
export function useReviewTarget(sessionId: string) {
  const [target, setTarget] = useState<{
    taskId: string;
    path?: string;
  } | null>(null);
  // Another conversation closes the review.
  useEffect(() => setTarget(null), [sessionId]);
  const open = useCallback(
    (taskId: string, path?: string) => setTarget({ taskId, path }),
    [],
  );
  const close = useCallback(() => setTarget(null), []);
  return { target, open, close };
}

/** The view consumes path lists, but only revision-validated marks reach it. */
export type Kept = { files: string[]; hunks: string[] };
type FileMark = { path: string; hash: string };
type HunkMark = FileMark & { id: string };
type Marks = { version: 2; files: FileMark[]; hunks: HunkMark[] };
const emptyMarks = (): Marks => ({ version: 2, files: [], hunks: [] });
export const keptKey = (taskId: string) => `shadow:review:${taskId}`;
export const hunkKey = (path: string, id: string) => `${path}#${id}`;
const nonempty = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

export function readKept(taskId: string): Marks {
  try {
    const value = JSON.parse(readStore(keptKey(taskId)) || "null");
    // Legacy path-only marks cannot attest to the current revision.
    if (value?.version !== 2) return emptyMarks();
    const valid = (mark: FileMark) =>
      mark && nonempty(mark.path) && nonempty(mark.hash);
    return {
      version: 2,
      files: Array.isArray(value.files) ? value.files.filter(valid) : [],
      hunks: Array.isArray(value.hunks)
        ? value.hunks.filter(
            (mark: HunkMark) => valid(mark) && nonempty(mark.id),
          )
        : [],
    };
  } catch {
    return emptyMarks();
  }
}

function reconcile(marks: Marks, files: ReviewFile[]): Marks {
  const matches = (mark: FileMark) =>
    files.some(
      (file) =>
        file.path === mark.path &&
        nonempty(file.hash) &&
        file.hash === mark.hash &&
        !["unchanged", "unavailable"].includes(file.status),
    );
  return {
    version: 2,
    files: marks.files.filter(matches),
    hunks: marks.hunks.filter(matches),
  };
}

/** Keep changes nothing on disk. Marks attest only to content actually shown
 * in this task, and Undo all still skips whole-file marks (not hunk marks). */
export function useTaskReview({
  taskId,
  initialPath,
  appBusy,
  toast,
  refresh,
}: {
  taskId: string;
  initialPath?: string;
  appBusy: boolean;
  toast: (text: string, kind?: ToastKind) => void;
  refresh: () => Promise<void>;
}) {
  // Each task owns its requests as well as its storage. A response from a
  // previous task must never update this one, even when paths are identical.
  const scope = useMemo(
    () => ({
      live: false,
      read: 0,
      detailRead: 0,
      detailVersion: 0,
      retryDetail: false,
      pending: 0,
      mutation: false,
      files: null as ReviewFile[] | null,
      detail: null as ReviewFileDetail | null,
      selected: initialPath || "",
      workspace: "",
      busy: false,
      error: "",
      marks: readKept(taskId),
    }),
    [taskId],
  );
  const [, redraw] = useState(0);
  const publish = useCallback(() => {
    if (scope.live) redraw((n) => n + 1);
  }, [scope]);
  const persist = useCallback(
    (marks: Marks) => {
      scope.marks = marks;
      writeStore(keptKey(taskId), JSON.stringify(marks));
    },
    [scope, taskId],
  );

  const load = useCallback(async () => {
    if (!scope.live) return null;
    const ticket = ++scope.read;
    scope.pending++;
    try {
      const result = await api.review(taskId);
      if (!scope.live || ticket !== scope.read) return null;
      if (result.task_id !== taskId)
        throw new Error("Review response belongs to a different task");
      if (scope.retryDetail) {
        scope.retryDetail = false;
        ++scope.detailVersion;
      }
      scope.files = result.files;
      scope.workspace = result.workspace;
      scope.busy = result.busy;
      scope.error = "";
      persist(reconcile(scope.marks, result.files));
      if (!result.files.some((file) => file.path === scope.selected))
        scope.selected =
          result.files.find((file) => file.status !== "unchanged")?.path ||
          result.files[0]?.path ||
          "";
      if (
        scope.detail &&
        !result.files.some(
          (file) =>
            file.path === scope.detail?.path && file.hash === scope.detail.hash,
        )
      ) {
        scope.detail = null;
        ++scope.detailRead;
      }
      publish();
      return result.files;
    } catch (error) {
      if (scope.live && ticket === scope.read) {
        scope.files = [];
        scope.detail = null;
        ++scope.detailRead;
        ++scope.detailVersion;
        scope.error = String(error);
        publish();
      }
      return null;
    } finally {
      scope.pending--;
    }
  }, [scope, taskId, persist, publish]);

  useEffect(() => {
    scope.live = true;
    return () => {
      scope.live = false;
      ++scope.read;
      ++scope.detailRead;
    };
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load, appBusy]);

  useEffect(() => {
    if (initialPath && initialPath !== scope.selected) {
      scope.selected = initialPath;
      scope.detail = null;
      ++scope.detailRead;
      publish();
    }
  }, [scope, initialPath, publish]);

  const selected = scope.selected;
  const revision = scope.files?.find((file) => file.path === selected)?.hash;
  const detailVersion = scope.detailVersion;
  useEffect(() => {
    if (!scope.live || !selected || !scope.files) return;
    const ticket = ++scope.detailRead;
    let live = true;
    void api
      .reviewFile(taskId, selected)
      .then((next) => {
        if (!live || !scope.live || ticket !== scope.detailRead) return;
        // List and detail are separate reads: never attach a different revision
        // to the list's kept marker. A subsequent refresh can reconcile the race.
        if (next.path !== selected || (revision && next.hash !== revision)) {
          scope.detail = null;
          persist({
            ...scope.marks,
            files: scope.marks.files.filter((mark) => mark.path !== selected),
            hunks: scope.marks.hunks.filter((mark) => mark.path !== selected),
          });
          scope.retryDetail = true;
          scope.error =
            "This file changed while its review was loading. Refreshing the review…";
          publish();
          return;
        }
        scope.detail = next;
        publish();
      })
      .catch((error) => {
        if (live && scope.live && ticket === scope.detailRead) {
          scope.detail = null;
          scope.retryDetail = true;
          toast(String(error), "err");
          publish();
        }
      });
    return () => {
      live = false;
    };
  }, [
    scope,
    taskId,
    selected,
    revision,
    detailVersion,
    toast,
    persist,
    publish,
  ]);

  const workspace = scope.workspace;
  useEffect(() => {
    const invalidate = () => {
      if (!scope.live || scope.mutation) return;
      // Immediately stop displaying previously validated marks. Storage is
      // reconciled only once a new authoritative listing arrives.
      scope.files = null;
      scope.detail = null;
      ++scope.detailRead;
      ++scope.detailVersion;
      publish();
      void load();
    };
    const focus = () => {
      if (document.visibilityState !== "hidden") invalidate();
    };
    const stopFiles = workspace
      ? onWorkspaceFilesChanged(workspace, invalidate)
      : undefined;
    const stopPoll = onVerificationRefresh(() => {
      if (!scope.pending && !scope.mutation) void load();
    });
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      stopFiles?.();
      stopPoll();
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [scope, workspace, load, publish]);

  const setSelected = (path: string) => {
    if (path === scope.selected) return;
    scope.selected = path;
    scope.detail = null;
    ++scope.detailRead;
    publish();
  };
  const detail = scope.detail;
  const mark = (path: string, id?: string) => {
    const file = scope.files?.find((item) => item.path === path);
    if (
      !scope.live ||
      scope.mutation ||
      !detail ||
      scope.detail !== detail ||
      detail.path !== path ||
      !nonempty(file?.hash) ||
      detail.hash !== file.hash ||
      ["unchanged", "unavailable"].includes(file.status) ||
      (id !== undefined && !detail.hunks.some((hunk) => hunk.id === id))
    )
      return;
    const identity = { path, hash: detail.hash };
    persist(
      id === undefined
        ? {
            ...scope.marks,
            files: [
              ...scope.marks.files.filter((m) => m.path !== path),
              identity,
            ],
          }
        : {
            ...scope.marks,
            hunks: [
              ...scope.marks.hunks.filter(
                (m) => m.path !== path || m.id !== id,
              ),
              { ...identity, id },
            ],
          },
    );
    // A read begun before this user action cannot overwrite its observation.
    ++scope.read;
    publish();
    void load();
  };

  const readOnly = appBusy || scope.busy;
  const beginUndo = () => {
    if (!scope.live || readOnly || scope.mutation) return false;
    scope.mutation = true;
    ++scope.read;
    ++scope.detailRead;
    publish();
    return true;
  };
  const undoOne = async (path: string, hunk?: string) => {
    const next = await api.reviewUndo(taskId, path, hunk);
    if (!scope.live) return false;
    // A pre-undo list/detail response must never revive the old revision.
    ++scope.read;
    if (scope.selected === path) {
      ++scope.detailRead;
      scope.detail = null;
    }
    const list = await load();
    if (!scope.live) return false;
    if (
      scope.selected === path &&
      list?.some((file) => file.path === path && file.hash === next.hash)
    ) {
      ++scope.detailRead;
      scope.detail = next;
    } else if (!scope.detail) {
      ++scope.detailVersion;
    }
    publish();
    void refresh().catch(() => undefined);
    return true;
  };
  const finishUndo = () => {
    scope.mutation = false;
    // beginUndo invalidates an in-flight detail. Failed/no-op/busy mutations
    // must replace that read even when the selected path and hash stay equal.
    // Preserve a valid detail from a newer selection or successful undo.
    if (!scope.detail && scope.selected) ++scope.detailVersion;
    publish();
  };
  async function undo(path: string, hunk?: string) {
    if (!beginUndo()) return false;
    try {
      return await undoOne(path, hunk);
    } catch (error) {
      if (scope.live) toast(String(error), "err");
      return false;
    } finally {
      finishUndo();
    }
  }
  async function undoAll() {
    if (!beginUndo()) return;
    // Restrict the operation to paths displayed when it was invoked.
    const shown = new Set(scope.files?.map((file) => file.path));
    let done = 0;
    try {
      const fresh = await load();
      if (!fresh || !scope.live || scope.busy) return;
      const kept = reconcile(scope.marks, fresh);
      const pending = fresh.filter(
        (file) =>
          shown.has(file.path) &&
          !kept.files.some((mark) => mark.path === file.path) &&
          !["unchanged", "unavailable"].includes(file.status),
      );
      for (const file of pending) {
        if (!scope.live || !(await undoOne(file.path))) break;
        done++;
      }
    } catch (error) {
      if (scope.live) toast(String(error), "err");
    } finally {
      finishUndo();
    }
    if (scope.live && done)
      toast(
        `Undid this task's changes in ${done} file${done === 1 ? "" : "s"}.`,
        "ok",
      );
  }

  const valid = reconcile(scope.marks, scope.files || []);
  return {
    files: scope.files,
    error: scope.error,
    readOnly,
    selected,
    setSelected,
    detail,
    kept: {
      files: valid.files.map((mark) => mark.path),
      hunks: valid.hunks.map((mark) => hunkKey(mark.path, mark.id)),
    } satisfies Kept,
    keepFile: (path: string) => mark(path),
    keepHunk: (path: string, id: string) => mark(path, id),
    undo,
    undoAll,
    working: scope.mutation,
    reload: load,
  };
}
