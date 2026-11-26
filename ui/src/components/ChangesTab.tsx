/** The drawer's Changes tab: git status, per-hunk stage / discard, and a
 * commit message draft that survives switching tabs. */
import { useEffect, useState } from "react";
import { readStore, writeStore } from "../lib/storage";
import { api, type DiffHunk } from "../api";
import { Empty } from "./cards";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  DiffHunk as DiffHunkView,
  LayoutToggle,
  type DiffLayout,
} from "./DiffView";
import { languageOf } from "../lib/diff";
import { useCommitGuard } from "../hooks/useCommitGuard";
import {
  remembered,
  type DrawerMemory,
  type DrawerMemoryUpdate,
} from "../hooks/useDrawerMemory";

type Toast = (text: string, kind?: "ok" | "err" | "info") => void;

/** Git porcelain codes in words (tooltip of the short label). */
const FILE_STATES: Record<string, string> = {
  "??": "New file, not tracked by git yet",
  M: "Modified",
  A: "Added",
  D: "Deleted",
  R: "Renamed",
  C: "Copied",
  U: "Conflict",
};

export function ChangesTab({
  path,
  busy,
  toast,
  onAskAgent,
  memory,
  onMemory,
  onOpenPr,
}: {
  path: string;
  busy: boolean;
  toast: Toast;
  onAskAgent?: (prompt: string) => void;
  memory: DrawerMemory;
  onMemory: DrawerMemoryUpdate;
  /** Switch to the Git tab (commit, push, open a pull request). */
  onOpenPr?: () => void;
}) {
  const [git, setGit] = useState<{
    error?: string;
    truncated?: boolean;
    status: string;
    log: string;
    files: { path: string; label: string }[];
    repo: boolean;
    loaded: boolean;
  }>({ status: "", log: "", files: [], repo: true, loaded: false });
  const [choice, setChoice] = useState(path);
  const [filter, setFilter] = useState("");
  const visible = git.files.filter((file) =>
    file.path.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  const selected =
    visible.find((file) => file.path === choice)?.path ||
    visible[0]?.path ||
    "";
  const [revision, setRevision] = useState(0);
  const refresh = () => setRevision((n) => n + 1);
  const [msg, setMsg] = remembered(memory, onMemory, "commitMessage");
  const [detail, setDetail] = useState<{
    path: string;
    revision: number;
    review?: Awaited<ReturnType<typeof api.gitDiff>>;
    error?: string;
  }>();
  const current =
    detail?.path === selected && detail.revision === revision
      ? detail
      : undefined;
  const review = current?.review;
  const [view, setView] = useState<"unstaged" | "staged">("unstaged");
  const [layout, setLayout] = useState<DiffLayout>(() =>
    readStore("shadow:diff-layout") === "split" ? "split" : "unified",
  );
  const [discard, setDiscard] = useState<{
    path: string;
    hunk: DiffHunk;
  } | null>(null);
  const [applying, setApplying] = useState(false);
  const guard = useCommitGuard(toast);
  const hunks =
    (view === "unstaged" ? review?.hunks : review?.staged_hunks) || [];
  let added = 0;
  let removed = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.kind === "add") added++;
      if (line.kind === "del") removed++;
    }
  }
  useEffect(() => {
    let active = true;
    void api.git().then(
      (g) => {
        if (active)
          setGit({
            status: g.status,
            log: g.log,
            files: g.files || [],
            repo: Boolean(g.repo),
            loaded: true,
            truncated: g.truncated,
          });
      },
      (error) => {
        if (active)
          setGit({
            status: "",
            log: "",
            files: [],
            repo: false,
            loaded: true,
            error: String(error),
          });
      },
    );
    return () => {
      active = false;
    };
  }, [busy, revision]);
  useEffect(() => {
    setChoice(path);
    setFilter("");
  }, [path]);
  useEffect(() => {
    let active = true;
    if (selected) {
      setDetail(undefined);
      void api.gitDiff(selected).then(
        (review) => {
          if (active) setDetail({ path: selected, revision, review });
        },
        (error) => {
          if (active)
            setDetail({ path: selected, revision, error: String(error) });
        },
      );
    }
    return () => {
      active = false;
    };
  }, [selected, busy, revision]);

  async function act(target: string, h: DiffHunk, action: "accept" | "reject") {
    setApplying(true);
    try {
      await api.hunkAction(target, h, action);
      toast(action === "accept" ? "Hunk staged" : "Hunk discarded", "ok");
    } catch (err) {
      toast(String(err), "err");
    } finally {
      refresh();
      setApplying(false);
    }
  }

  if (!git.loaded)
    return (
      <div className="skel-rows">
        <span className="skel" />
        <span className="skel short" />
      </div>
    );
  if (git.error)
    return (
      <div role="alert">
        {git.error}{" "}
        <button type="button" className="mini" onClick={refresh}>
          Retry
        </button>
      </div>
    );
  if (!git.repo)
    return (
      <Empty
        title="Not a git repository"
        body="Initialize git in this folder to review and stage changes."
      />
    );
  return (
    <>
      <header className="changes-heading">
        <h3>Changed files</h3>
        <span>
          {filter ? `${visible.length} of ` : ""}
          {git.files.length}
          {git.truncated ? "+" : ""}
        </span>
        <button type="button" className="mini" onClick={refresh}>
          Refresh
        </button>
      </header>
      {(git.files.length > 0 || filter) && (
        <input
          type="search"
          className="changes-filter"
          aria-label="Filter changed files"
          placeholder="Filter by file or folder…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      )}
      {git.truncated && (
        <p className="hint">Git returned a partial file list.</p>
      )}
      {filter && !visible.length && (
        <p role="status" className="hint">
          No changed paths match this filter.
        </p>
      )}
      <div className="list">
        {git.files.length === 0 && <Empty title="Working tree clean" />}
        {visible.map((f) => (
          <button
            type="button"
            key={f.path}
            className={`file ${selected === f.path ? "active" : ""}`}
            aria-pressed={selected === f.path}
            onClick={() => setChoice(f.path)}
          >
            <span
              className="file-label"
              title={FILE_STATES[f.label] || f.label}
            >
              {f.label === "??" ? "New" : f.label}
            </span>
            {f.path}
          </button>
        ))}
      </div>
      {selected && (
        <div className="hunks">
          <div className="crumb">
            <span>{selected}</span>
          </div>
          <div className="changes-controls">
            <div className="seg" role="group" aria-label="Change scope">
              <button
                type="button"
                className={view === "unstaged" ? "on" : ""}
                aria-pressed={view === "unstaged"}
                onClick={() => setView("unstaged")}
              >
                Unstaged
              </button>
              <button
                type="button"
                className={view === "staged" ? "on" : ""}
                aria-pressed={view === "staged"}
                onClick={() => setView("staged")}
              >
                Staged
              </button>
            </div>
            <LayoutToggle
              layout={layout}
              onLayout={(value) => {
                setLayout(value);
                writeStore("shadow:diff-layout", value);
              }}
            />
          </div>
          {!current && (
            <p className="hint" role="status">
              Loading diff…
            </p>
          )}
          {current?.error && <p role="alert">{current.error}</p>}
          {hunks.length > 0 && (
            <div className="diff-tally" aria-label="Visible diff summary">
              <strong>
                {hunks.length} {hunks.length === 1 ? "hunk" : "hunks"}
              </strong>
              <span aria-label={`${added} added lines`}>+{added}</span>
              <span aria-label={`${removed} removed lines`}>−{removed}</span>
            </div>
          )}
          {review?.binary && (
            <p className="hint">Binary file. Text preview is unavailable.</p>
          )}
          {review?.truncated && (
            <p className="hint">
              Preview truncated. Review the full file before staging.
            </p>
          )}
          {review?.untracked && (
            <div className="row">
              <p className="hint">New file</p>
              <button
                type="button"
                className="mini"
                disabled={busy || applying}
                onClick={() =>
                  void api
                    .gitAdd([selected])
                    .then(async () => {
                      refresh();
                      setView("staged");
                    })
                    .catch((e) => toast(String(e), "err"))
                }
              >
                Stage file
              </button>
            </div>
          )}
          {review && !review.binary && hunks.length === 0 && (
            <p className="hint">No {view} text changes for this file.</p>
          )}
          {hunks.map((h, i) => (
            <DiffHunkView
              key={i}
              hunk={{
                header: h.header,
                lines: h.lines.map((line) => ({
                  kind:
                    line.kind === "add" ||
                    line.kind === "del" ||
                    line.kind === "meta"
                      ? line.kind
                      : "ctx",
                  text: line.text,
                })),
              }}
              layout={layout}
              language={languageOf(selected)}
              actions={
                view === "unstaged" &&
                !review?.untracked &&
                !review?.truncated ? (
                  <>
                    <button
                      type="button"
                      className="mini"
                      disabled={busy || applying}
                      onClick={() => void act(selected, h, "accept")}
                    >
                      Stage
                    </button>
                    <button
                      type="button"
                      className="mini danger-text"
                      disabled={busy || applying}
                      onClick={() => setDiscard({ path: selected, hunk: h })}
                    >
                      Discard
                    </button>
                    {onAskAgent && (
                      <button
                        type="button"
                        className="mini"
                        onClick={() => {
                          const body = h.lines
                            .map(
                              (line) =>
                                `${line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}${line.text}`,
                            )
                            .join("\n");
                          onAskAgent(
                            `Review this hunk in ${selected}:\n${h.header}\n${body}\nAdjust or explain as needed.`,
                          );
                          toast("Hunk queued in composer", "info");
                        }}
                      >
                        Ask agent
                      </button>
                    )}
                  </>
                ) : undefined
              }
            />
          ))}
        </div>
      )}
      <div className="commit">
        <input
          aria-label="Commit message"
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          placeholder="Commit message"
        />
        <button
          type="button"
          className="mini"
          disabled={busy || applying}
          onClick={() =>
            void api
              .gitAdd(["."])
              .then(refresh)
              .catch((e) => toast(String(e), "err"))
          }
        >
          Stage all
        </button>
        <button
          type="button"
          className="mini primary-mini"
          disabled={busy || !msg.trim()}
          onClick={() =>
            void guard
              .commit(msg, () => {
                setMsg("");
                refresh();
                toast("Committed", "ok");
              })
              .catch((err) => toast(String(err), "err"))
          }
        >
          Commit
        </button>
        {onOpenPr && (
          <button type="button" className="mini" onClick={onOpenPr}>
            Open pull request…
          </button>
        )}
      </div>
      <pre className="plan log">{git.log}</pre>
      {guard.dialog}
      {discard && (
        <ConfirmDialog
          title="Discard this change?"
          confirmLabel="Discard change"
          danger
          onCancel={() => setDiscard(null)}
          onConfirm={async () => {
            await act(discard.path, discard.hunk, "reject");
            setDiscard(null);
          }}
        >
          <p>
            The lines in <code>{discard.hunk.header}</code> of {discard.path} go
            back to the last staged or committed version. This cannot be undone.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
