import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  Clock,
  FolderGit2,
  GitBranch,
  Play,
  RefreshCw,
  ShieldAlert,
  Square,
  Terminal,
  XCircle,
} from "lucide-react";
import {
  api,
  type Approval,
  type BackgroundTask,
  type Job,
  type ManagedWorktree,
  type Session,
} from "../api";
import type { ApprovalDecision } from "./ApprovalCard";
import type { DrawerTab } from "./Drawer";

export type MissionFilter =
  | "all"
  | "active"
  | "approval"
  | "queued"
  | "done"
  | "failed";

type MissionRow = {
  id: string;
  sessionId: string;
  title: string;
  workspace: string;
  status: string;
  model: string;
  task: string;
  updatedAt: number;
  needsApproval: boolean;
  jobId?: string;
};

const ACTIVE_STATUSES = new Set(["running", "paused", "starting", "working"]);
const FAILED_STATUSES = new Set(["failed", "cancelled", "interrupted", "limit_reached"]);

function formatTimeAgo(epochSec: number): string {
  if (!epochSec) return "";
  const ms = epochSec > 1e12 ? epochSec : epochSec * 1000;
  const diff = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function statusMeta(status: string, needsApproval: boolean): {
  label: string;
  tone: "active" | "warn" | "queued" | "ok" | "danger" | "idle";
} {
  if (needsApproval) return { label: "Needs approval", tone: "warn" };
  if (status === "paused") return { label: "Paused", tone: "warn" };
  if (ACTIVE_STATUSES.has(status)) return { label: "Working", tone: "active" };
  if (status === "queued") return { label: "Queued", tone: "queued" };
  if (status === "completed" || status === "done")
    return { label: "Completed", tone: "ok" };
  if (FAILED_STATUSES.has(status))
    return {
      label: status === "limit_reached" ? "Limit reached" : status[0].toUpperCase() + status.slice(1),
      tone: "danger",
    };
  return { label: "Idle", tone: "idle" };
}

/** Multi-agent command center: live execution deck, approval triage, worktrees,
 * and background processes across the workspace. */
export function MissionControl({
  workspace,
  sessions,
  jobs,
  approvals,
  waitingSessions,
  onOpenSession,
  onNewTask,
  onDecide,
  onCancelJob,
  onOpenPanel,
  onClose,
  toast,
}: {
  workspace: string;
  sessions: Session[];
  jobs: Job[];
  approvals: Approval[];
  waitingSessions: readonly string[];
  onOpenSession: (sessionId: string) => void;
  onNewTask: () => void;
  onDecide: (approvalId: string, answer: ApprovalDecision) => void;
  onCancelJob?: (jobId: string) => Promise<void>;
  onOpenPanel: (tab: DrawerTab) => void;
  onClose: () => void;
  toast: (text: string, kind?: "ok" | "err" | "info") => void;
}) {
  const [filter, setFilter] = useState<MissionFilter>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("priority");
  const request = useRef(0);
  const [infraErrors, setInfraErrors] = useState({ worktrees: false, background: false });
  const [worktrees, setWorktrees] = useState<ManagedWorktree[]>([]);
  const [bgTasks, setBgTasks] = useState<BackgroundTask[]>([]);
  const [loadingInfra, setLoadingInfra] = useState(true);
  const [stoppingJob, setStoppingJob] = useState<string | null>(null);
  const [stoppingBg, setStoppingBg] = useState<string | null>(null);

  const loadInfra = useCallback(async () => {
    const generation = ++request.current;
    setLoadingInfra(true);
    try {
      const [wtResult, bgResult] = await Promise.allSettled([
        api.worktrees(),
        api.background(),
      ]);
      if (generation !== request.current) return;
      setInfraErrors({ worktrees: wtResult.status === "rejected", background: bgResult.status === "rejected" });
      if (wtResult.status === "fulfilled") {
        setWorktrees(wtResult.value.worktrees || []);
      }
      if (bgResult.status === "fulfilled") {
        setBgTasks(bgResult.value.tasks || []);
      }
    } finally {
      if (generation === request.current) setLoadingInfra(false);
    }
  }, []);

  useEffect(() => {
    setWorktrees([]);
    setBgTasks([]);
    setInfraErrors({ worktrees: false, background: false });
    void loadInfra();
    return () => { ++request.current; };
  }, [loadInfra, workspace]);

  const rows = useMemo<MissionRow[]>(() => {
    const bySession = new Map<string, Session>();
    for (const s of sessions) bySession.set(s.id, s);

    const seenSessions = new Set<string>();
    const list: MissionRow[] = [];

    const activeByTask = new Map<string, Job>();
    const activeBySession = new Map<string, Job[]>();
    for (const job of jobs) {
      if (!ACTIVE_STATUSES.has(job.status)) continue;
      if (job.task_id) activeByTask.set(job.task_id, job);
      const group = activeBySession.get(job.session_id) ?? [];
      group.push(job);
      activeBySession.set(job.session_id, group);
    }

    const waitingJobs = new Set<string>();
    const waitingAtSession = new Set<string>();
    const sessionsWithRequests = new Set<string>();
    function markSession(sessionId: string) {
      const candidates = activeBySession.get(sessionId);
      if (candidates?.length === 1) waitingJobs.add(candidates[0].id);
      else waitingAtSession.add(sessionId);
    }
    for (const approval of approvals) {
      const job = approval.task_id ? activeByTask.get(approval.task_id) : undefined;
      const sessionId = approval.session_id || job?.session_id;
      if (!sessionId) continue;
      sessionsWithRequests.add(sessionId);
      if (!approval.task_id) markSession(sessionId);
      else if (job?.session_id === sessionId) waitingJobs.add(job.id);
      else waitingAtSession.add(sessionId);
    }
    for (const id of waitingSessions) {
      if (!sessionsWithRequests.has(id)) markSession(id);
    }

    for (const j of jobs) {
      const s = bySession.get(j.session_id);
      seenSessions.add(j.session_id);
      list.push({
        id: `job:${j.id}`,
        sessionId: j.session_id,
        title: s?.title || j.task?.slice(0, 64) || "Untitled task",
        workspace: j.workspace || s?.workspace || workspace,
        status: j.status,
        model: j.model || "",
        task: j.task || "",
        updatedAt: j.finished_at || j.started_at || 0,
        needsApproval: waitingJobs.has(j.id),
        jobId: j.id,
      });
    }

    for (const sessionId of new Set([...bySession.keys(), ...waitingAtSession])) {
      if (seenSessions.has(sessionId) && !waitingAtSession.has(sessionId)) continue;
      const s = bySession.get(sessionId);
      list.push({
        id: `session:${sessionId}`,
        sessionId,
        title: s?.title || "New task",
        workspace: s?.workspace || workspace,
        status: seenSessions.has(sessionId) ? "idle" : s?.status || "idle",
        model: "",
        task: "",
        updatedAt: s?.updated_at || 0,
        needsApproval: waitingAtSession.has(sessionId),
      });
    }

    const rank = (row: MissionRow) => {
      if (row.needsApproval) return 0;
      if (ACTIVE_STATUSES.has(row.status)) return 1;
      if (row.status === "queued") return 2;
      if (FAILED_STATUSES.has(row.status)) return 3;
      if ((row.status === "completed" || row.status === "done")) return 4;
      return 5;
    };

    return list.sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt);
  }, [jobs, sessions, approvals, waitingSessions, workspace]);

  const counts = useMemo(() => {
    let active = 0;
    let queued = 0;
    let done = 0;
    let failed = 0;
    for (const r of rows) {
      if (ACTIVE_STATUSES.has(r.status)) active++;
      else if (r.status === "queued") queued++;
      else if ((r.status === "completed" || r.status === "done")) done++;
      else if (FAILED_STATUSES.has(r.status)) failed++;
    }
    const approvalCount = rows.filter((r) => r.needsApproval).length;
    return {
      all: rows.length,
      active,
      approval: approvalCount,
      queued,
      done,
      failed,
    };
  }, [rows]);

  const byStatus = useMemo(() => {
    if (filter === "all") return rows;
    if (filter === "active") return rows.filter((r) => ACTIVE_STATUSES.has(r.status));
    if (filter === "approval") return rows.filter((r) => r.needsApproval);
    if (filter === "queued") return rows.filter((r) => r.status === "queued");
    if (filter === "done") return rows.filter((r) => r.status === "completed" || r.status === "done");
    if (filter === "failed") return rows.filter((r) => FAILED_STATUSES.has(r.status));
    return rows;
  }, [rows, filter]);

  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = byStatus.filter((row) => {
    const text = [row.title, row.task, row.workspace, row.model].join(" ").toLowerCase();
    return terms.every((term) => text.includes(term));
  });
  if (sort === "newest") filtered.sort((a, b) => b.updatedAt - a.updatedAt);
  if (sort === "oldest") filtered.sort((a, b) => a.updatedAt - b.updatedAt);

  const runningBg = bgTasks.filter((t) => t.status === "running");

  async function handleStopJob(jobId: string) {
    if (!onCancelJob) return;
    setStoppingJob(jobId);
    try {
      await onCancelJob(jobId);
      toast("Task stopped", "info");
    } catch (err) {
      toast(String(err), "err");
    } finally {
      setStoppingJob(null);
    }
  }

  async function handleStopBg(task: BackgroundTask) {
    setStoppingBg(task.id);
    try {
      await api.stopBackground(task.id);
      toast(`Stopped ${task.name}`, "info");
      await loadInfra();
    } catch (err) {
      toast(String(err), "err");
    } finally {
      setStoppingBg(null);
    }
  }

  const filterTabs: { id: MissionFilter; label: string; count: number }[] = [
    { id: "all", label: "All", count: counts.all },
    { id: "active", label: "Working", count: counts.active },
    { id: "approval", label: "Needs approval", count: counts.approval },
    { id: "queued", label: "Queued", count: counts.queued },
    { id: "done", label: "Completed", count: counts.done },
    { id: "failed", label: "Stopped / Failed", count: counts.failed },
  ];

  return (
    <section className="mission-control" aria-label="Mission Control">
      <header className="mission-header">
        <div className="mission-title-group">
          <button
            type="button"
            className="ghost mission-back"
            onClick={onClose}
            aria-label="Back to chat"
          >
            <ArrowLeft size={15} aria-hidden="true" />
            <span>Back to chat</span>
          </button>
          <div>
            <h2>Mission Control</h2>
            <p className="mission-subtitle">
              Live command center for active agents, approvals, worktrees, and
              background processes.
            </p>
          </div>
        </div>
        <div className="mission-header-actions">
          <button
            type="button"
            className="ghost"
            onClick={() => void loadInfra()}
            disabled={loadingInfra}
            aria-label="Refresh Mission Control"
          >
            <RefreshCw size={14} aria-hidden="true" />
            <span>Refresh</span>
          </button>
          <button type="button" className="primary" onClick={onNewTask}>
            <Play size={14} aria-hidden="true" />
            <span>New task</span>
          </button>
        </div>
      </header>

      <div className="mission-kpis" role="region" aria-label="Fleet summary">
        <div className={`mission-kpi ${counts.active > 0 ? "kpi-active" : ""}`}>
          <span className="mission-kpi-label">
            <Activity size={14} aria-hidden="true" />
            Active agents
          </span>
          <strong className="mission-kpi-value">{counts.active}</strong>
        </div>
        <div
          className={`mission-kpi ${counts.approval > 0 ? "kpi-warn" : ""}`}
        >
          <span className="mission-kpi-label">
            <ShieldAlert size={14} aria-hidden="true" />
            Needs approval
          </span>
          <strong className="mission-kpi-value">{counts.approval}</strong>
        </div>
        <div className="mission-kpi">
          <span className="mission-kpi-label">
            <Clock size={14} aria-hidden="true" />
            Queued tasks
          </span>
          <strong className="mission-kpi-value">{counts.queued}</strong>
        </div>
        <div className="mission-kpi">
          <span className="mission-kpi-label">
            <FolderGit2 size={14} aria-hidden="true" />
            Worktrees · Procs
          </span>
          <strong className="mission-kpi-value">
            {infraErrors.worktrees || loadingInfra ? "…" : worktrees.length} · {infraErrors.background || loadingInfra ? "…" : runningBg.length}
          </strong>
        </div>
      </div>

      {approvals.length > 0 && (
        <section
          className="mission-section mission-approvals"
          aria-label="Pending approvals"
        >
          <div className="mission-section-head">
            <h3>
              <ShieldAlert size={15} aria-hidden="true" />
              Pending approvals ({approvals.length})
            </h3>
          </div>
          <div className="mission-approval-list">
            {approvals.map((a) => {
              const session = sessions.find((s) => s.id === a.session_id);
              return (
                <div key={a.id} className="mission-approval-card">
                  <div className="mission-approval-body">
                    <div className="mission-approval-meta">
                      <strong>{a.tool || "Tool request"}</strong>
                      {session && (
                        <span className="mission-pill">
                          {session.title || "Untitled task"}
                        </span>
                      )}
                    </div>
                    <p>{a.reason || "Waiting for your approval"}</p>
                  </div>
                  <div className="mission-approval-actions">
                    <button
                      type="button"
                      className="mini primary-mini"
                      onClick={() => onDecide(a.id, { decision: "approve" })}
                    >
                      Allow
                    </button>
                    <button
                      type="button"
                      className="mini danger-text"
                      onClick={() => onDecide(a.id, { decision: "deny" })}
                    >
                      Deny
                    </button>
                    {a.session_id && (
                      <button
                        type="button"
                        className="mini"
                        onClick={() => onOpenSession(a.session_id!)}
                      >
                        Open
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="mission-section" aria-label="Execution deck">
        <div className="mission-section-head">
          <h3>Execution deck</h3>
          <div
            className="mission-filters"
            role="tablist"
            aria-label="Filter tasks"
          >
            {filterTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={filter === tab.id}
                className={`mission-filter ${filter === tab.id ? "on" : ""}`}
                onClick={() => setFilter(tab.id)}
              >
                <span>{tab.label}</span>
                {tab.count > 0 && (
                  <span className="mission-filter-count">{tab.count}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="mission-search-tools">
          <input type="search" aria-label="Search execution deck" placeholder="Find a task, project or model…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select aria-label="Sort tasks" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="priority">Priority first</option>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
          {search && <span role="status">{filtered.length} {filtered.length === 1 ? "match" : "matches"}</span>}
        </div>
        {filtered.length === 0 ? (
          <div className="mission-empty">
            <p>No tasks match this filter.</p>
          </div>
        ) : (
          <div className="mission-deck">
            {filtered.map((row) => {
              const meta = statusMeta(row.status, row.needsApproval);
              const folder = row.workspace.split(/[\\/]/).filter(Boolean).at(-1) || row.workspace;
              const isActive =
                ACTIVE_STATUSES.has(row.status) || row.status === "queued";
              return (
                <article key={row.id} className="mission-card">
                  <div className="mission-card-main">
                    <div className="mission-card-top">
                      <span className={`mission-badge tone-${meta.tone}`}>
                        {meta.tone === "ok" && (
                          <CheckCircle2 size={12} aria-hidden="true" />
                        )}
                        {meta.tone === "danger" && (
                          <XCircle size={12} aria-hidden="true" />
                        )}
                        {meta.tone === "active" && (
                          <Activity size={12} aria-hidden="true" />
                        )}
                        {meta.tone === "warn" && (
                          <ShieldAlert size={12} aria-hidden="true" />
                        )}
                        {meta.label}
                      </span>
                      <span className="mission-folder" title={row.workspace}>
                        {folder}
                      </span>
                      {row.model && (
                        <span className="mission-model">{row.model}</span>
                      )}
                      {row.updatedAt > 0 && (
                        <span className="mission-time">
                          {formatTimeAgo(row.updatedAt)}
                        </span>
                      )}
                    </div>
                    <h4 className="mission-card-title">{row.title}</h4>
                    {row.task && row.task !== row.title && (
                      <p className="mission-card-prompt">{row.task}</p>
                    )}
                  </div>
                  <div className="mission-card-actions">
                    {isActive && row.jobId && onCancelJob && (
                      <button
                        type="button"
                        className="mini danger-text"
                        disabled={stoppingJob === row.jobId}
                        onClick={() => void handleStopJob(row.jobId!)}
                      >
                        <Square size={11} aria-hidden="true" />
                        {stoppingJob === row.jobId ? "Stopping…" : "Stop"}
                      </button>
                    )}
                    <button
                      type="button"
                      className="mini"
                      onClick={() => onOpenSession(row.sessionId)}
                    >
                      Open thread
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <div className="mission-infra-grid">
        <section className="mission-section" aria-label="Managed worktrees">
          <div className="mission-section-head">
            <h3>
              <GitBranch size={15} aria-hidden="true" />
              Worktrees {!(loadingInfra || infraErrors.worktrees) && `(${worktrees.length})`}
            </h3>
            <button
              type="button"
              className="mini"
              onClick={() => onOpenPanel("worktrees")}
            >
              Manage
            </button>
          </div>
          {infraErrors.worktrees ? <p role="status" className="mission-empty-inline">Worktrees unavailable. Refresh to retry.</p> : loadingInfra ? <p className="mission-empty-inline">Loading worktrees…</p> : worktrees.length === 0 ? (
            <p className="mission-empty-inline">
              No active isolated worktrees in this project.
            </p>
          ) : (
            <ul className="mission-infra-list">
              {worktrees.map((wt) => (
                <li key={wt.path} className="mission-infra-item">
                  <div>
                    <strong>{wt.branch || wt.path.split(/[\\/]/).filter(Boolean).at(-1)}</strong>
                    <span className="mission-infra-sub">{wt.path}</span>
                  </div>
                  <span className="mission-pill">{wt.state || "ready"}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mission-section" aria-label="Background processes">
          <div className="mission-section-head">
            <h3>
              <Terminal size={15} aria-hidden="true" />
              Background processes {!(loadingInfra || infraErrors.background) && `(${runningBg.length} running)`}
            </h3>
            <button
              type="button"
              className="mini"
              onClick={() => onOpenPanel("background")}
            >
              Manage
            </button>
          </div>
          {infraErrors.background ? <p role="status" className="mission-empty-inline">Process list unavailable. Refresh to retry.</p> : loadingInfra ? <p className="mission-empty-inline">Loading processes…</p> : bgTasks.length === 0 ? (
            <p className="mission-empty-inline">
              No background dev servers or watchers running.
            </p>
          ) : (
            <ul className="mission-infra-list">
              {bgTasks.slice(0, 6).map((t) => (
                <li key={t.id} className="mission-infra-item">
                  <div>
                    <strong>{t.name}</strong>
                    <span className="mission-infra-sub">{t.command}</span>
                  </div>
                  <div className="row">
                    <span
                      className={`mission-pill ${t.status === "running" ? "tone-active" : ""}`}
                    >
                      {t.status}
                    </span>
                    {t.status === "running" && (
                      <button
                        type="button"
                        className="mini danger-text"
                        disabled={stoppingBg === t.id}
                        onClick={() => void handleStopBg(t)}
                      >
                        Stop
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}
